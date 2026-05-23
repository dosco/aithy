---
name: Dataset Reconciliation
description: Compare files, join keys, find mismatches, duplicates, drift, and produce reconciliation reports.
when_to_use: Use when the user asks to compare two or more datasets, verify consistency, or find mismatched rows.
tools: Bash(python3:*) Read Write
tags: builtin dataset reconciliation compare pandas csv xlsx
---

# Dataset Reconciliation

Use this for comparison and mismatch work across files.

Workflow:

1. Profile each dataset: row count, columns, key candidates, duplicate keys, and null keys.
2. Confirm or infer join keys from column names and content.
3. Produce match, left-only, right-only, and changed-record summaries.
4. Export mismatch details and a concise reconciliation report.
5. Call out uncertain key choices and duplicate-key effects.

Do not treat fuzzy matches as facts unless the user asks for fuzzy matching.
