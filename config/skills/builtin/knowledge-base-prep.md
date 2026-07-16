---
name: Knowledge Base Prep
description: Turn mixed source folders into clean, chunkable Markdown with manifests and source references.
when_to_use: Use when the user wants documents prepared for retrieval, RAG, notes, or an LLM-ready knowledge base.
tools: Bash(find:*) Bash(docling:*) Bash(python3:*) Read Write
required_sandbox_capabilities: document
tags: builtin knowledge-base rag markdown documents manifest chunking
---

# Knowledge Base Prep

Use this when the goal is downstream retrieval or reusable context, not just one converted file.

Workflow:

1. Inventory all inputs and group by type.
2. Convert supported files to Markdown with stable source-relative paths.
3. Normalize headings, remove repeated boilerplate only when obvious, and keep source citations.
4. Write a manifest with original path, converted path, title, byte count, content hash, citations, and warnings.
5. Create chunk-friendly Markdown: clear headings, short sections, tables preserved as tables.

Do not delete source nuance for brevity unless the user asks for summarization.

## Aithy / OKF destination

When the user explicitly names Aithy or OKF as the destination:

1. Produce an OKF v0.1 folder; do not import it automatically.
2. Give every non-reserved concept a stable bundle-relative `.md` path and YAML frontmatter with a non-empty `type`. Add useful `title`, `description`, `resource`, `tags`, and ISO timestamp fields.
3. Keep source citations under `# Citations` and use normal bundle-relative or relative Markdown links between concepts.
4. Add root and directory `index.md` files for progressive navigation. Use `log.md` only for dated history entries.
5. Preserve a JSON manifest beside the bundle for source-to-concept mapping and validation warnings.
6. Return the prepared folder as an artifact for the user to review and import from Knowledge Library.
