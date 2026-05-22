import { createHash } from "node:crypto";
import type { SkillEntry } from "./types";

export interface SkillEmbeddingChunk {
  key: string;
  text: string;
}

const CHUNK_CHARS = 2_000;

export function skillEmbeddingChunks(skill: SkillEntry): SkillEmbeddingChunk[] {
  const chunks: SkillEmbeddingChunk[] = [{
    key: "card",
    text: [
      skill.name,
      skill.description,
      skill.when_to_use ? `when to use: ${skill.when_to_use}` : null,
      skill.tags ? `tags: ${skill.tags}` : null,
      skill.allowed_tools ? `tools: ${skill.allowed_tools}` : null,
    ].filter(Boolean).join("\n"),
  }];
  chunks.push(...splitChunks("body", skill.body));
  for (const file of skill.files) {
    chunks.push(...splitChunks(`file:${file.path}`, file.content));
  }
  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}

export function skillDocText(skill: SkillEntry): string {
  return skillEmbeddingChunks(skill)
    .map((chunk) => chunk.text)
    .join("\n\n")
    .slice(0, 8_000);
}

export function skillChunkHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function splitChunks(prefix: string, text: string): SkillEmbeddingChunk[] {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: SkillEmbeddingChunk[] = [];
  for (let start = 0; start < clean.length; start += CHUNK_CHARS) {
    chunks.push({
      key: `${prefix}:${chunks.length}`,
      text: clean.slice(start, start + CHUNK_CHARS),
    });
  }
  return chunks;
}
