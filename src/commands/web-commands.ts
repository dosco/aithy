export interface WebSlashCommand {
  name: string;
  label: string;
  description: string;
}

export const WEB_SLASH_COMMANDS: WebSlashCommand[] = [
  {
    name: "skills",
    label: "/skills",
    description: "Search and attach skills to the next message",
  },
];

export function visibleWebSlashCommands(query: string): WebSlashCommand[] {
  const normalized = query.trim().replace(/^\//, "").toLowerCase();
  if (!normalized) return WEB_SLASH_COMMANDS;
  return WEB_SLASH_COMMANDS.filter((command) => command.name.startsWith(normalized));
}
