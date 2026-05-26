---
name: Office Document Extraction
description: Extract text, tables, slides, and workbook data from DOCX, PPTX, and XLSX files.
when_to_use: Use when the user specifically provides Office files or asks to extract content from Word, PowerPoint, or Excel.
tools: Bash(docling:*) Bash(python3:*) Read Write
required_sandbox_capabilities: document
tags: builtin office docx pptx xlsx docling openpyxl pandas
---

# Office Document Extraction

Prefer `docling` for Word and PowerPoint documents. Use Python libraries for workbook inspection and data extraction.

Workflow:

1. Identify the Office format and whether the user wants text, tables, slides, or structured data.
2. Use Docling for DOCX/PPTX extraction into Markdown or JSON.
3. For XLSX, use `openpyxl` for workbook metadata and formulas, or `pandas` for table-like sheets.
4. Preserve sheet names, slide numbers, headings, and table labels in the output.
5. Note unsupported embedded objects, macros, or external links if discovered.

Do not claim macro execution safety or inspect hidden content beyond what the tools actually read.
