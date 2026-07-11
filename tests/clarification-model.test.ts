import { describe, expect, test } from "bun:test";
import { multipleChoiceAnswer, toggleClarificationChoice } from "../app/components/clarification-model";

describe("clarification selection model", () => {
  test("toggles labels and sends transcript-faithful labels in order", () => {
    let selected = toggleClarificationChoice([], "Alpha");
    selected = toggleClarificationChoice(selected, "Beta");
    expect(multipleChoiceAnswer(selected)).toBe("Alpha, Beta");
    expect(toggleClarificationChoice(selected, "Alpha")).toEqual(["Beta"]);
  });
});
