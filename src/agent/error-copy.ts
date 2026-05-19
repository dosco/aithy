export function userFacingErrorText(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error ?? "");
  return stripErrorPrefixes(raw) || "Something went wrong.";
}

export function stripErrorPrefixes(input: string): string {
  let text = input.trim();
  while (/^(?:Error|[A-Za-z][A-Za-z -]* Error):\s*/.test(text)) {
    text = text.replace(/^(?:Error|[A-Za-z][A-Za-z -]* Error):\s*/, "").trim();
  }
  return text;
}
