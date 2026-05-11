export type PrimaryClearAction = "model" | "key";

export function primaryClearCopy(action: PrimaryClearAction | null) {
  if (action === "key") {
    return {
      title: "Clear primary API key?",
      body: "Aithy will forget the stored primary key for this bot and return to setup until a key is set again.",
      confirmLabel: "Clear key",
    };
  }
  return {
    title: "Clear primary model?",
    body: "Aithy will remove the primary model and return to setup until a model is selected again.",
    confirmLabel: "Clear model",
  };
}

export function saveButtonLabel(busy: boolean, saved: boolean) {
  if (busy) return "Testing...";
  return saved ? "Saved" : "Save settings";
}

export function networkValue(value: string) {
  return value === "public" || value === "allow-all" ? value : "none";
}
