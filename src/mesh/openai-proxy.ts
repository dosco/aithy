import type { AxChatRequest, AxChatResponse, AxEmbedResponse, AxFunctionJSONSchema } from "@ax-llm/ax";
import { createAiService } from "../agent/ai-service";
import type { AppConfig } from "../config/env";
import { isMeshProvider } from "./types";
import type { RuntimeStore } from "../runtime/runtime-store";

export interface MeshInferenceDeps {
  config: AppConfig;
  runtimeStore?: RuntimeStore;
}

export async function handleMeshOpenAiProxy(
  path: string,
  body: unknown,
  deps: MeshInferenceDeps,
): Promise<unknown> {
  if (isMeshProvider(deps.config.aiProvider)) {
    throw new Error("Refusing to proxy a mesh inference request back into mesh.");
  }
  if (path.endsWith("/chat/completions")) {
    return chatCompletions(body, deps);
  }
  if (path.endsWith("/embeddings")) {
    return embeddings(body, deps);
  }
  throw new Error(`Unsupported mesh inference endpoint: ${path}`);
}

async function chatCompletions(body: unknown, deps: MeshInferenceDeps): Promise<unknown> {
  const request = object(body);
  if (request.stream === true) throw new Error("Mesh inference does not support streaming in v1.");
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const service = createAiService({ config: deps.config, runtimeStore: deps.runtimeStore });
  const response = await service.chat({
    chatPrompt: messages.map(openAiMessageToAx).filter((item): item is AxChatRequest["chatPrompt"][number] => Boolean(item)),
    model: stringValue(request.model) ?? deps.config.aiModel,
    functions: openAiToolsToAxFunctions(request.tools),
    functionCall: openAiToolChoiceToAx(request.tool_choice),
    responseFormat: responseFormat(request.response_format),
    modelConfig: modelConfig(request),
  } as AxChatRequest);
  if (response instanceof ReadableStream) throw new Error("Unexpected streaming response from mesh inference.");
  return axChatToOpenAi(response, stringValue(request.model) ?? deps.config.aiModel ?? "mesh");
}

async function embeddings(body: unknown, deps: MeshInferenceDeps): Promise<unknown> {
  const request = object(body);
  const input = request.input;
  const texts = Array.isArray(input)
    ? input.map((item) => typeof item === "string" ? item : JSON.stringify(item))
    : [typeof input === "string" ? input : JSON.stringify(input ?? "")];
  const service = createAiService({ config: deps.config, runtimeStore: deps.runtimeStore });
  const response = await service.embed({
    texts,
    embedModel: stringValue(request.model) ?? undefined,
  });
  return axEmbedToOpenAi(response, stringValue(request.model) ?? deps.config.aiModel ?? "mesh");
}

function openAiMessageToAx(message: unknown): AxChatRequest["chatPrompt"][number] | null {
  const record = object(message);
  const role = stringValue(record.role);
  if (role === "system") {
    return { role, content: contentText(record.content) };
  }
  if (role === "user") {
    return { role, content: contentText(record.content), ...(stringValue(record.name) ? { name: stringValue(record.name) } : {}) };
  }
  if (role === "assistant") {
    const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
    return {
      role,
      ...(contentText(record.content) ? { content: contentText(record.content) } : {}),
      ...(toolCalls.length > 0 ? { functionCalls: toolCalls.map(openAiToolCallToAx).filter(Boolean) as never } : {}),
    };
  }
  if (role === "tool" || role === "function") {
    return {
      role: "function",
      result: contentText(record.content),
      functionId: stringValue(record.tool_call_id) ?? stringValue(record.name) ?? "tool",
    };
  }
  return null;
}

function openAiToolCallToAx(value: unknown) {
  const record = object(value);
  const fn = object(record.function);
  const name = stringValue(fn.name);
  if (!name) return null;
  return {
    id: stringValue(record.id) ?? crypto.randomUUID(),
    type: "function" as const,
    function: {
      name,
      params: stringValue(fn.arguments) ?? object(fn.arguments),
    },
  };
}

function openAiToolsToAxFunctions(value: unknown): AxChatRequest["functions"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const functions = value.flatMap((tool) => {
    const record = object(tool);
    if (record.type !== "function") return [];
    const fn = object(record.function);
    const name = stringValue(fn.name);
    const description = stringValue(fn.description);
    if (!name || !description) return [];
    return [{
      name,
      description,
      parameters: object(fn.parameters) as AxFunctionJSONSchema,
    }];
  });
  return functions.length > 0 ? functions : undefined;
}

function openAiToolChoiceToAx(value: unknown): AxChatRequest["functionCall"] | undefined {
  if (value === "none" || value === "auto" || value === "required") return value;
  const record = object(value);
  const fn = object(record.function);
  const name = stringValue(fn.name);
  return name ? { type: "function", function: { name } } : undefined;
}

function responseFormat(value: unknown): AxChatRequest["responseFormat"] | undefined {
  const format = object(value);
  if (format.type === "json_object") return { type: "json_object" };
  if (format.type === "json_schema") return { type: "json_schema", schema: object(format.json_schema) };
  return undefined;
}

function modelConfig(value: Record<string, unknown>): AxChatRequest["modelConfig"] {
  return {
    ...(numberValue(value.temperature) !== undefined ? { temperature: numberValue(value.temperature) } : {}),
    ...(numberValue(value.top_p) !== undefined ? { topP: numberValue(value.top_p) } : {}),
    ...(numberValue(value.max_tokens ?? value.max_completion_tokens) !== undefined
      ? { maxTokens: numberValue(value.max_tokens ?? value.max_completion_tokens) }
      : {}),
  };
}

function axChatToOpenAi(response: AxChatResponse, model: string): unknown {
  return {
    id: response.remoteId ?? `mesh-chat-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: response.results.map((result, index) => ({
      index,
      message: {
        role: "assistant",
        content: result.content ?? "",
        ...(result.functionCalls?.length
          ? { tool_calls: result.functionCalls.map((call) => ({ id: call.id, type: "function", function: call.function })) }
          : {}),
      },
      finish_reason: result.finishReason ?? "stop",
    })),
    usage: usage(response),
  };
}

function axEmbedToOpenAi(response: AxEmbedResponse, model: string): unknown {
  return {
    object: "list",
    model,
    data: response.embeddings.map((embedding, index) => ({ object: "embedding", embedding, index })),
    usage: usage(response),
  };
}

function usage(response: Pick<AxChatResponse | AxEmbedResponse, "modelUsage">) {
  const tokens = response.modelUsage?.tokens;
  return {
    prompt_tokens: tokens?.promptTokens ?? 0,
    completion_tokens: tokens?.completionTokens ?? 0,
    total_tokens: tokens?.totalTokens ?? 0,
  };
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    const record = object(part);
    if (record.type === "text") return stringValue(record.text) ?? "";
    if (record.type === "image_url") return "[image]";
    return "";
  }).join("\n").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
