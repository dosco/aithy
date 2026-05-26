import type { SkillEntry } from "./types";

export function formatSkillContent(skill: SkillEntry): string {
  return formatSkill(skill);
}

export function formatSkillSearchContent(skill: SkillEntry): string {
  return formatSkill(skill, { maxBodyChars: 2_400 });
}

function formatSkill(skill: SkillEntry, options: { maxBodyChars?: number } = {}): string {
  const parts: string[] = [`### ${skill.name}`, `ID: ${skill.id}`];
  if (skill.description) parts.push(skill.description);
  if (skill.when_to_use) parts.push(`**When to use:** ${skill.when_to_use}`);
  if (skill.tags) parts.push(`**Tags:** ${skill.tags}`);
  if (skill.allowed_tools) parts.push(`**Allowed tools:** ${skill.allowed_tools}`);
  if (skill.required_sandbox_capabilities) {
    parts.push(`**Required sandbox capabilities:** ${skill.required_sandbox_capabilities}`);
  }
  if (skill.links.length > 0) parts.push(`**Related skills:** ${skill.links.join(", ")}`);
  if (skill.files.length > 0) {
    parts.push([
      "**Supporting files:**",
      ...skill.files.map((file) => `- ${file.path} (${file.bytes} bytes)`),
      "Use `skills.read` with this skill ID and file path when you need one of these files.",
    ].join("\n"));
  }
  if (skill.body) parts.push(cap(skill.body, options.maxBodyChars));
  return parts.join("\n\n");
}

function cap(value: string, maxChars: number | undefined): string {
  if (!maxChars || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 13)} [truncated]`;
}
