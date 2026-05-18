import type { SkillEntry } from "./types";

export function formatSkillContent(skill: SkillEntry): string {
  const parts: string[] = [`### ${skill.name}`, `ID: ${skill.id}`];
  if (skill.description) parts.push(skill.description);
  if (skill.when_to_use) parts.push(`**When to use:** ${skill.when_to_use}`);
  if (skill.tags) parts.push(`**Tags:** ${skill.tags}`);
  if (skill.allowed_tools) parts.push(`**Allowed tools:** ${skill.allowed_tools}`);
  if (skill.links.length > 0) parts.push(`**Related skills:** ${skill.links.join(", ")}`);
  if (skill.files.length > 0) {
    parts.push([
      "**Supporting files:**",
      ...skill.files.map((file) => `- ${file.path} (${file.bytes} bytes)`),
      "Use `skills.read` with this skill ID and file path when you need one of these files.",
    ].join("\n"));
  }
  if (skill.body) parts.push(skill.body);
  return parts.join("\n\n");
}
