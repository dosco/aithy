---
name: CJK Document Handling
description: Preserve Chinese, Japanese, and Korean text rendering with Noto CJK fonts and explicit OCR limits.
when_to_use: Use when documents contain CJK text, multilingual fonts, rendered output, or text extraction with missing glyphs.
tools: Bash(fc-list:*) Bash(docling:*) Bash(pdftotext:*) Bash(python3:*) Read Write
tags: builtin cjk fonts noto multilingual pdf documents
---

# CJK Document Handling

Use this for multilingual text and font/rendering issues.

Workflow:

1. Check whether text extraction preserves CJK characters.
2. Verify Noto CJK fonts are available with `fc-list`.
3. Prefer text-preserving conversion before OCR.
4. When rendering pages, use installed Noto/Noto CJK fonts where tools allow font fallback.
5. Clearly separate text extraction quality from visual rendering quality.

Limits:

- The default image installs English Tesseract data only.
- Do not claim CJK OCR support unless additional language packs are installed.
