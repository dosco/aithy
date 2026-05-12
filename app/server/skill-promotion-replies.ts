import { handleSkillPromotionReply } from "../../src/skills/promote-acceptance";
import type { ChannelMessage } from "../../src/channel/types";
import type { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";

type Runtime = Awaited<ReturnType<typeof getAithyRuntime>>;

export function tryHandleSkillPromotionReply(input: {
  runtime: Runtime;
  user: ChannelMessage;
  publishSessions: (runtime: Runtime) => void;
}) {
  const { runtime, user } = input;
  const result = handleSkillPromotionReply({
    conversationId: user.conversationId,
    text: user.text,
    createdAt: user.createdAt,
    sessions: runtime.sessions,
    promotions: runtime.skillPromotions,
    skills: runtime.skills,
  });
  if (!result.handled) return null;
  const assistant = result.assistant ?? {
    role: "assistant" as const,
    kind: "text" as const,
    content: "",
    createdAt: new Date().toISOString(),
  };
  return assistant;
}
