import { f, fn, type AxAgentFunction } from "@ax-llm/ax";
import type { ToolContext } from "../tool-context";

export function createMemoryTools(ctx: ToolContext): AxAgentFunction[] {
  if (!ctx.enqueueRemember) return [];
  const enqueue = ctx.enqueueRemember;

  return [
    fn("remember")
      .namespace("memory")
      .description(
        "Ask the memory subsystem to save something the user just told you. Call this only when the user explicitly asks you to remember something. The memory triage agent decides what to actually persist; you do not write directly.",
      )
      .arg("hint", f.string("The user's request, ideally verbatim. Include enough context for the triage agent to act."))
      .returnsField("queued", f.boolean("Whether the request was queued"))
      .handler(async ({ hint }) => {
        await enqueue({ hint, sessionId: ctx.session.conversationId });
        return { queued: true };
      })
      .build(),
  ];
}
