import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { sessionMessagePageDto } from "./dto";

const messagePageInput = z.object({
  conversationId: z.string().min(1),
  beforeId: z.number().int().positive().nullable().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

export const getSessionMessages = createServerFn({ method: "GET" })
  .inputValidator(messagePageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    runtime.sessions.ensureLogicalSession(data.conversationId);
    return sessionMessagePageDto(runtime, data.conversationId, {
      beforeId: data.beforeId ?? null,
      limit: data.limit ?? 10,
    });
  });
