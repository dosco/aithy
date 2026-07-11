export function toggleClarificationChoice(selected: readonly string[], label: string): string[] {
  return selected.includes(label)
    ? selected.filter((item) => item !== label)
    : [...selected, label];
}

export function multipleChoiceAnswer(selected: readonly string[]): string {
  return selected.join(", ");
}
