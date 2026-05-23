---
name: PDF Optimization And Print Output
description: Compress, linearize, and prepare PDFs for sharing or print using Ghostscript and qpdf.
when_to_use: Use when the user asks to reduce PDF size, optimize for web, linearize, or create print-friendly output.
tools: Bash(gs:*) Bash(qpdf:*) Bash(pdfinfo:*) Read Write
tags: builtin pdf ghostscript qpdf optimize compress print
---

# PDF Optimization And Print Output

Create new outputs and compare them with the original.

Workflow:

1. Record original size, page count, and PDF metadata.
2. Use Ghostscript presets for size or print tradeoffs.
3. Use `qpdf --linearize` for web-friendly loading when requested.
4. Validate output with `qpdf --check`.
5. Report size delta and any expected quality tradeoffs.

Do not overwrite originals. If image quality matters, prefer a conservative preset.
