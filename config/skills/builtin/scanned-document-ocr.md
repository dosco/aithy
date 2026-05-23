---
name: Scanned Document OCR
description: OCR scanned PDFs and images using Docling or Tesseract with extraction quality checks.
when_to_use: Use when a PDF or image appears scanned, text extraction is empty, or the user asks for OCR.
tools: Bash(docling:*) Bash(tesseract:*) Bash(pdftoppm:*) Bash(pdfinfo:*) Read Write
tags: builtin ocr scanned pdf image tesseract docling english
---

# Scanned Document OCR

Use OCR only when needed. Try normal text extraction first for PDFs.

Workflow:

1. Check if the file already has embedded text.
2. For scanned PDFs, use Docling OCR first.
3. For individual images, use `tesseract INPUT stdout -l eng`.
4. For PDF page images, rasterize with Poppler when needed, then OCR page by page.
5. Return OCR text with page markers and a quality note.

Limits:

- The default sandbox installs English Tesseract data only.
- Mark low-confidence pages, skewed scans, handwriting, stamps, and unreadable regions as uncertain.
