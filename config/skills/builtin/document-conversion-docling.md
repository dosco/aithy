---
name: Document Conversion (Docling)
description: Convert a single mixed document into clean Markdown, JSON, HTML, or text using Docling first.
when_to_use: Use when the user asks to process one PDF, Office document, image, or other document into Markdown, JSON, HTML, or plain text.
tools: Bash(docling:*) Bash(pdftotext:*) Bash(pdfinfo:*) Read Write
tags: builtin documents docling conversion markdown json html pdf office image
---

# Document Conversion (Docling)

Use `docling` first for a single document unless the user explicitly asks for a lower-level tool.

Preferred commands:

```bash
docling INPUT --to md --output output/
docling INPUT --to json --output output/
docling INPUT --to html --output output/
docling INPUT --no-ocr --to md --output output/
```

Workflow:

1. Inspect the input filename, extension, and size.
2. Choose Markdown by default; use JSON only when structure is requested.
3. Use `--no-ocr` for clean digital PDFs when speed matters.
4. Check the output exists and sample the beginning and end.
5. Report warnings for missing pages, extraction errors, or obvious table/figure loss.

Fallbacks:

- `pdftotext INPUT.pdf -` is acceptable for fast digital-PDF text extraction.
- Tesseract is English-only in the default image unless more language packs are installed.
