---
name: PDF Fast Text Extraction
description: Quickly extract digital PDF text and metadata using Poppler tools before heavier conversion.
when_to_use: Use when the user wants quick plain text, metadata, page count, or a fast PDF inspection.
tools: Bash(pdftotext:*) Bash(pdfinfo:*) Bash(pdffonts:*) Read Write
required_sandbox_capabilities: document
tags: builtin pdf poppler text metadata fast
---

# PDF Fast Text Extraction

Use Poppler for fast digital-PDF inspection.

Commands:

```bash
pdfinfo INPUT.pdf
pdffonts INPUT.pdf
pdftotext INPUT.pdf -
pdftotext -layout INPUT.pdf output.txt
```

Workflow:

1. Get page count and metadata with `pdfinfo`.
2. Extract text with `pdftotext`; use `-layout` for table-like pages.
3. Sample beginning, middle, and end for extraction quality.
4. If text is empty or garbled, switch to OCR or Docling.
