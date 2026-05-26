---
name: PDF Repair And Validation
description: Validate PDFs, inspect encryption, and attempt non-destructive qpdf repair.
when_to_use: Use when a PDF will not open, conversion fails, qpdf reports errors, or the user asks to repair/validate a PDF.
tools: Bash(qpdf:*) Bash(pdfinfo:*) Read Write
required_sandbox_capabilities: document
tags: builtin pdf qpdf repair validation encryption
---

# PDF Repair And Validation

Use non-destructive validation and repair attempts.

Workflow:

1. Run `qpdf --check INPUT.pdf`.
2. Inspect `pdfinfo` output when possible.
3. Attempt repair by writing a new file with qpdf.
4. Re-run validation on the repaired output.
5. Report exact errors and whether the output is fully valid, partially repaired, or still broken.

Do not claim password removal or access bypass. If encrypted content requires a password, ask for one through normal user flow.
