---
name: docling-processor
description: High-quality document → clean Markdown/JSON conversion using Docling (preferred) + legacy fallbacks. Handles PDF, DOCX, PPTX, XLSX, images, scanned docs, tables, figures, formulas.
prerequisites: docling command available
tools: docling, pdftotext, pandoc, tesseract
---

# Document Processor (Docling-First)

**Always prefer `docling` over any other tool** unless the user explicitly asks for a legacy tool (e.g. "use only pdftotext" or "use pandoc").

### Primary Command (recommended)

```bash
# Default = best quality Markdown + structured output
docling INPUT_FILE --output OUTPUT_DIR

# Common useful flags
docling INPUT_FILE --to md --output output/          # Markdown (default)
docling INPUT_FILE --to json --output output/        # Full structured JSON
docling INPUT_FILE --to html --output output/        # HTML with layout
docling INPUT_FILE --no-ocr --output output/         # Skip OCR on clean PDFs (faster)
```

### When to use legacy tools (only if Docling is unavailable or user requests)

- `pdftotext INPUT.pdf -` → fast plain text
- `pandoc INPUT.docx -o output.md` → Office → Markdown
- `tesseract INPUT.png stdout` → pure OCR fallback

### Output Guidelines

- Always produce clean, LLM-ready Markdown by default.
- Include tables as proper Markdown tables.
- Extract figures/captions when present.
- If JSON is requested, return the full DoclingDocument structure.

**Override Rule (important)**:
If the user says "process this document", "extract text", "convert to markdown", "handle this PDF", etc. → **default to `docling` first**. Never fall back to poppler/pandoc unless `docling` fails or the user specifically overrides.
