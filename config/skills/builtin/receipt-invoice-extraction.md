---
name: Receipt And Invoice Extraction
description: Extract structured fields and line items from receipts, invoices, and simple forms into CSV or JSON.
when_to_use: Use for receipts, invoices, purchase orders, bills, statements, or form-like scanned documents.
tools: Bash(docling:*) Bash(tesseract:*) Bash(python3:*) Read Write
required_sandbox_capabilities: document
tags: builtin receipts invoices forms ocr csv json
---

# Receipt And Invoice Extraction

Extract facts; do not provide financial, tax, or legal judgment.

Workflow:

1. OCR or convert the document to text/Markdown.
2. Identify visible fields: vendor, date, invoice number, totals, currency, tax, line items, addresses.
3. Preserve uncertainty with empty fields or notes instead of guessing.
4. Output JSON for structured use or CSV for line items.
5. Include source page references when multi-page.

If totals do not reconcile, report the mismatch as an extraction warning rather than correcting it silently.
