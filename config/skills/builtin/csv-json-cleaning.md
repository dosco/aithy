---
name: CSV And JSON Cleaning
description: Clean CSV/JSON files with delimiter detection, schema normalization, dedupe, validation, and exports.
when_to_use: Use when the user asks to clean messy CSV, TSV, JSON, JSONL, or convert between these table formats.
tools: Bash(python3:*) Read Write
tags: builtin csv json cleaning pandas validation dedupe
---

# CSV And JSON Cleaning

Use Python for reproducible cleaning steps.

Workflow:

1. Detect encoding, delimiter, header presence, and row count.
2. Normalize column names while preserving an original-name map.
3. Handle missing values, duplicate rows, type coercion, and invalid records explicitly.
4. Export cleaned data and a rejected-rows file when applicable.
5. Write a short data-quality report.

Do not silently drop records. Record every filter or coercion.
