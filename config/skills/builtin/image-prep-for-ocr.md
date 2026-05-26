---
name: Image Prep For OCR
description: Prepare images for OCR with Pillow-based cleanup, resizing, grayscale, contrast, crop, and thresholding.
when_to_use: Use when OCR is poor because the source image is skewed, low contrast, too small, noisy, or oddly cropped.
tools: Bash(python3:*) Bash(tesseract:*) Read Write
required_sandbox_capabilities: document
tags: builtin image ocr pillow preprocessing tesseract
---

# Image Prep For OCR

Use Pillow to create OCR-ready derivatives before running OCR.

Workflow:

1. Inspect dimensions, format, color mode, and file size.
2. Create derived images; never destroy the original.
3. Try grayscale, contrast adjustment, resizing to a readable DPI-equivalent size, crop, and thresholding.
4. Run Tesseract on the best candidate and compare sample output.
5. Save derivatives only when useful for review.

Keep a small log of attempted transforms so the user can understand why the chosen output is better.
