---
name: PDF Page Range Assembly
description: Split, merge, reorder, and extract PDF page ranges with qpdf and clear output manifests.
when_to_use: Use when the user asks to split PDFs, combine PDFs, remove pages, reorder pages, or extract ranges.
tools: Bash(qpdf:*) Bash(pdfinfo:*) Read Write
required_sandbox_capabilities: document
tags: builtin pdf qpdf split merge pages
---

# PDF Page Range Assembly

Use qpdf for page-level PDF assembly.

Workflow:

1. Inspect page counts with `pdfinfo`.
2. Confirm or infer page ranges from the user request.
3. Use qpdf for split, merge, rotation, and page selection.
4. Validate output with `qpdf --check`.
5. Return a manifest of input files, page ranges, and output file paths.

Never remove pages destructively from the original. Write new output files.
