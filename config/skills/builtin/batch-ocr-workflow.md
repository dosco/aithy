---
name: Batch OCR Workflow
description: OCR many PDFs or images with per-file logs, page markers, failures, and summary outputs.
when_to_use: Use when the user asks to OCR a folder, archive, or multiple scanned files.
tools: Bash(find:*) Bash(docling:*) Bash(pdftotext:*) Bash(tesseract:*) Bash(pdftoppm:*) Bash(python3:*) Read Write
required_sandbox_capabilities: document
tags: builtin batch ocr scanned documents logs
---

# Batch OCR Workflow

Use this for multi-file OCR. Keep the process auditable.

Workflow:

1. Inventory files and detect PDFs versus images.
2. For PDFs, sample embedded text with `pdftotext` before choosing OCR.
3. Create output folders for text, Markdown, page images if needed, and logs.
4. OCR each file independently with page markers.
5. Record status, warnings, elapsed time, and output path per file.
6. Produce a summary table with success, partial success, and failure counts.

Do not hide failures. If a page is unreadable, keep its page marker and note the issue.
