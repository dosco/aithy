import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { serializableMessage } from "../../src/web/live-events";
import type { MessagePageDto } from "./dto";

const messagePageInput = z.object({
  conversationId: z.string().min(1),
  beforeId: z.number().int().positive().nullable().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

export const getSessionMessages = createServerFn({ method: "GET" })
  .inputValidator(messagePageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    return sessionMessagesPageState(runtime, data);
  });

export async function sessionMessagesPageState(
  runtime: Pick<AithyRuntime, "sessions" | "sessionState">,
  data: z.infer<typeof messagePageInput>,
): Promise<MessagePageDto> {
  const input = {
    beforeId: data.beforeId ?? null,
    limit: data.limit ?? 10,
  };
  await runtime.sessionState.preloadSession(data.conversationId);
  if (!runtime.sessions.getSummary(data.conversationId)) return emptyMessagePageDto();
  await runtime.sessionState.preloadMessages(data.conversationId, input);
  const page = runtime.sessions.messagesPage(data.conversationId, input);
  return {
    ...page,
    items: page.items.map((item) => ({
      id: item.id,
      message: serializableMessage(item.message),
    })),
  };
}

function emptyMessagePageDto(): MessagePageDto {
  return {
    items: [],
    oldestId: null,
    newestId: null,
    hasMoreBefore: false,
  };
}
