---
name: Research Paper Extraction
description: Extract paper structure, abstracts, sections, figures, captions, equations, tables, and references.
when_to_use: Use for scholarly papers, technical PDFs, preprints, journal articles, whitepapers, or reports with citations.
tools: Bash(docling:*) Bash(pdftotext:*) Bash(pdfinfo:*) Bash(python3:*) Read Write
tags: builtin research paper pdf citations figures tables equations
---

# Research Paper Extraction

Use Docling structured output when a paper has figures, tables, captions, formulas, or references.

Workflow:

1. Capture title, authors, publication metadata when visible, page count, and document type.
2. Extract Markdown for reading and JSON for structure-sensitive work.
3. Preserve section hierarchy, figure captions, table captions, equations, and references.
4. Check table and figure counts against the paper visually or from extracted structure when possible.
5. Produce a short extraction quality note with missing or uncertain elements.

Avoid inventing citation details. If metadata is not visible or extractable, say so.
