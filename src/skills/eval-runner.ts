import { ax, f, type AxAgentFunctionCall, type AxFunctionCallTrace } from "@ax-llm/ax";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SandboxProvider } from "../sandbox/provider";
import type { SessionManager } from "../session/session-manager";
import { createAiService, createFastAiService } from "../agent/ai-service";
import { createAithyAgent } from "../agent/create-agent";
import { createSandboxTools } from "../agent/tools/sandbox-tools";
import { formatSkillContent, type SqliteSkillsStore } from "./skills-store";
import type { SkillEvalCaseResult, SkillEvalDefinition } from "./evals";
import type { SqliteUsageStore } from "../usage/usage-store";
import { captureProgramUsage, usageAttributionForConfig } from "../usage/capture";

const synthesisSignature = f().input("skillContent", f.string()).input("caseCount", f.number())
  .output("caseRequests", f.string().array()).output("evalCriteria", f.string().array()).build();
const judgeSignature = f().input("userRequest", f.string()).input("successCriteria", f.string()).input("assistantResponse", f.string())
  .input("recordedToolCalls", f.string()).output("score", f.number("Score from 0 to 1"))
  .output("rationale", f.string()).build();

export interface SkillEvalRunnerDeps {
  config: AppConfig; events: EventBus; sessions: SessionManager; sandbox: SandboxProvider; skills: SqliteSkillsStore; usage?: SqliteUsageStore;
}

export class SkillEvalRunner {
  constructor(private readonly deps: SkillEvalRunnerDeps) {}

  async run(skillId: string): Promise<{ cases: SkillEvalCaseResult[]; model: string | null }> {
    const skill = this.deps.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    const cases = [...skill.evals];
    if (cases.length < 3) cases.push(...await synthesizeCases(this.deps, formatSkillContent(skill), 3 - cases.length));
    while (cases.length < 3) cases.push({ request: `Use ${skill.name} for a representative task (${cases.length + 1}).`, criteria: `Follows the ${skill.name} workflow accurately and safely.` });
    const results: SkillEvalCaseResult[] = [];
    for (const [index, evalCase] of cases.slice(0, 5).entries()) {
      results.push(await this.runCase(skillId, evalCase, index));
    }
    return { cases: results, model: this.deps.config.fastAiModel ?? this.deps.config.aiModel ?? null };
  }

  private async runCase(skillId: string, evalCase: SkillEvalDefinition, index: number): Promise<SkillEvalCaseResult> {
    const skill = this.deps.skills.get(skillId)!;
    const conversationId = `skill-eval-${crypto.randomUUID()}`;
    const session = await this.deps.sessions.get(conversationId);
    const toolCalls: unknown[] = [];
    const tools = skill.required_sandbox_capabilities
      ? createSandboxTools({ session, sandbox: this.deps.sandbox, sessions: this.deps.sessions,
          workspacePath: this.deps.config.workspaceRoot, events: this.deps.events }, this.deps.config.sandboxProvider)
        .filter((tool) => allowedSandboxToolForEval(skill.allowed_tools, `${tool.namespace}.${tool.name}`))
      : [];
    try {
      const { program, llm } = createAithyAgent({ config: this.deps.config, tools, events: this.deps.events,
        conversationId, onFunctionCall: (call: AxFunctionCallTrace | AxAgentFunctionCall) => { toolCalls.push(call); } });
      const output = await program.forward(llm, {
        userRequest: evalCase.request, conversationHistory: "",
        channelContext: { channelId: "skill-eval", conversationId, senderId: "eval", case: index + 1 },
      }, { skills: [{ id: skill.id, name: skill.name, content: formatSkillContent(skill) }] });
      capture(this.deps, program, conversationId);
      const response = String(output.agentResponse ?? "");
      const judged = await judgeCase(this.deps, evalCase, response, toolCalls);
      return { ...evalCase, response, toolCalls, score: judged.score, rationale: judged.rationale,
        status: judged.score >= 0.5 ? "passed" : "failed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/permission|approval|requires runtime storage/i.test(message)) {
        return { ...evalCase, response: "", toolCalls, score: null, rationale: message, status: "blocked" };
      }
      throw error;
    } finally {
      await this.deps.sessions.deleteSession(conversationId);
    }
  }
}

async function synthesizeCases(deps: SkillEvalRunnerDeps, skill: string, count: number): Promise<SkillEvalDefinition[]> {
  const llm = createFastAiService(deps) ?? createAiService(deps);
  const program = ax(synthesisSignature, { description: "Create diverse skill eval cases. Return exactly the requested count.", maxSteps: 1 } as never);
  const output = await program.forward(llm as never, { skillContent: skill, caseCount: count });
  capture(deps, program, null);
  const requests = Array.isArray(output.caseRequests) ? output.caseRequests : [];
  const criteria = Array.isArray(output.evalCriteria) ? output.evalCriteria : [];
  return requests.slice(0, count).flatMap((request, index) => {
    const criterion = criteria[index];
    return typeof request === "string" && typeof criterion === "string" && request.trim() && criterion.trim()
      ? [{ request: request.trim(), criteria: criterion.trim() }] : [];
  });
}

async function judgeCase(deps: SkillEvalRunnerDeps, evalCase: SkillEvalDefinition, response: string, toolCalls: unknown[]) {
  const llm = createFastAiService(deps) ?? createAiService(deps);
  const program = ax(judgeSignature, { description: "Judge whether the response and recorded tool calls satisfy the criteria. Score 0 to 1 with a concise rationale.", maxSteps: 1 } as never);
  const output = await program.forward(llm, { userRequest: evalCase.request, successCriteria: evalCase.criteria, assistantResponse: response,
    recordedToolCalls: JSON.stringify(toolCalls).slice(0, 20_000) });
  capture(deps, program, null);
  return { score: Math.max(0, Math.min(1, Number(output.score) || 0)), rationale: String(output.rationale ?? "") };
}

function capture(deps: SkillEvalRunnerDeps, program: unknown, sessionId: string | null): void {
  if (!deps.usage) return;
  captureProgramUsage(program, { store: deps.usage, purpose: "skill.eval", sessionId,
    attribution: usageAttributionForConfig(deps.config) });
}

export function allowedSandboxToolForEval(allowed: string | null, fullName: string): boolean {
  if (!fullName.startsWith("sandbox.")) return false;
  if (!allowed) return false;
  const names = allowed.split(/\s+/);
  if (names.some((name) => name === fullName || name === fullName.slice("sandbox.".length))) return true;
  if (fullName === "sandbox.bash") return names.some((name) => /^Bash(?:\(|$)/.test(name));
  return fullName === "sandbox.edit" && names.some((name) => /^(Edit$|Write$)/.test(name));
}
