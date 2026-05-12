export function sandboxNameFor(botId: string): string {
  return `aithy-${botId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
}
