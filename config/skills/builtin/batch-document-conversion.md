---
name: Batch Document Conversion
description: Convert a folder of documents with stable output names, logs, manifests, and artifact-ready results.
when_to_use: Use when the user asks to process many files, a folder, or an archive of documents into a consistent output set.
tools: Bash(find:*) Bash(docling:*) Bash(python3:*) Bash(unzip:*) Read Write
tags: builtin documents batch docling conversion manifest artifacts
---

# Batch Document Conversion

Use this for folder-level conversion, not a single file.

Workflow:

1. Inventory inputs with `find`, extensions, sizes, and duplicate basenames.
2. Create an output directory with subfolders for converted files, logs, and manifests.
3. Convert each supported document with `docling`, preserving a stable stem-based output name.
4. Write a manifest containing source path, output path, status, warnings, and byte size.
5. Summarize failures separately instead of hiding them.

Guidelines:

- Do not overwrite outputs silently; use deterministic suffixes for collisions.
- Keep the final package under `$AITHY_OUTBOX` when the user asks for a deliverable.
- For archives, list contents before extraction and avoid path traversal.
