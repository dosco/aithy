---
name: PDF Security Inspection
description: Inspect PDF metadata, encryption flags, attachments, and risky features without claiming secure redaction.
when_to_use: Use when the user asks what is inside a PDF, whether it is encrypted, or whether metadata/attachments are present.
tools: Bash(qpdf:*) Bash(pdfinfo:*) Bash(pdfdetach:*) Read Write
required_sandbox_capabilities: document
tags: builtin pdf security metadata encryption attachments
---

# PDF Security Inspection

Inspect and report observable PDF properties.

Workflow:

1. Run `pdfinfo` for metadata, permissions, page count, and encryption flags.
2. Run `qpdf --check` for structural validity.
3. Use Poppler attachment tools when attachment inspection is requested.
4. Save a concise report with commands used and findings.

Limits:

- Do not claim malware analysis.
- Do not claim secure redaction. Removing visible text is not proof that hidden content is gone.
