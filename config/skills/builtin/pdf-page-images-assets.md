---
name: PDF Page Images And Assets
description: Rasterize PDF pages, create thumbnails/contact sheets, and extract visual review assets.
when_to_use: Use when the user wants page images, thumbnails, contact sheets, screenshots, or visual PDF review artifacts.
tools: Bash(pdftoppm:*) Bash(pdfimages:*) Bash(pdfinfo:*) Bash(python3:*) Read Write
tags: builtin pdf images thumbnails assets poppler pillow
---

# PDF Page Images And Assets

Use Poppler for page images and Pillow for contact sheets.

Workflow:

1. Inspect page count and choose target pages or all pages.
2. Use `pdftoppm` for page rasterization.
3. Use `pdfimages` when embedded images are requested.
4. Use Pillow to build thumbnails or contact sheets.
5. Save outputs under a clear folder with page-numbered filenames.

Keep resolution reasonable unless the user needs high-detail inspection.
