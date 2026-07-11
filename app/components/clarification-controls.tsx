import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/settings-form-bits";
import type { SerializableBotMessage } from "../../src/web/live-events";
import { multipleChoiceAnswer, toggleClarificationChoice } from "./clarification-model";

type Clarification = NonNullable<Extract<SerializableBotMessage, { kind: "text" }>["clarification"]>;

export function ClarificationControls({
  clarification,
  onSubmit,
}: {
  clarification: Clarification;
  onSubmit: (text: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [value, setValue] = useState("");
  const choices = clarification.choices ?? [];

  if (clarification.type === "single_choice") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {choices.map((choice) => (
          <Button key={choice.value} type="button" variant="soft" onClick={() => onSubmit(choice.label)}>
            {choice.label}
          </Button>
        ))}
      </div>
    );
  }
  if (clarification.type === "multiple_choice") {
    return (
      <div className="mt-3 grid gap-2">
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => {
            const active = selected.includes(choice.label);
            return (
              <Button
                key={choice.value}
                type="button"
                variant={active ? "default" : "soft"}
                aria-pressed={active}
                onClick={() => setSelected((current) => toggleClarificationChoice(current, choice.label))}
              >
                {choice.label}
              </Button>
            );
          })}
        </div>
        <Button
          type="button"
          className="w-fit"
          disabled={selected.length === 0}
          onClick={() => onSubmit(multipleChoiceAnswer(selected))}
        >
          Send choices
        </Button>
      </div>
    );
  }
  if (clarification.type === "number" || clarification.type === "date") {
    return (
      <form className="mt-3 flex max-w-sm gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (value) onSubmit(value);
      }}>
        <input
          className={fieldClass}
          type={clarification.type}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" disabled={!value}>Send</Button>
      </form>
    );
  }
  return null;
}
