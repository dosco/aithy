import type { AxAgentStructuredClarification } from "@ax-llm/ax";
import type { AssistantClarification } from "../session/types";

export function normalizeClarification(
  clarification: AxAgentStructuredClarification,
): AssistantClarification {
  return {
    type: clarification.type ?? "text",
    ...(clarification.choices?.length
      ? {
          choices: clarification.choices.map((choice) => typeof choice === "string"
            ? { label: choice, value: choice }
            : { label: choice.label, value: choice.value ?? choice.label }),
        }
      : {}),
  };
}
