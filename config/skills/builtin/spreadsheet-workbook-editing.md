---
name: Spreadsheet Workbook Editing
description: Create or modify XLSX workbooks with sheets, formulas, formatting, widths, and validation notes.
when_to_use: Use when the user asks to create, edit, format, or add sheets/formulas to an Excel workbook.
tools: Bash(python3:*) Read Write
tags: builtin spreadsheet xlsx openpyxl workbook formulas formatting
---

# Spreadsheet Workbook Editing

Use openpyxl when workbook structure and formatting matter.

Workflow:

1. Load the workbook and list sheets before editing.
2. Preserve existing sheets unless the user asks to replace them.
3. Add formulas as formulas, not precomputed text, when the user expects spreadsheet behavior.
4. Set widths, freeze panes, headers, and number formats where useful.
5. Save to a new file and report changed sheets.

Do not evaluate formulas unless a calculation engine is available; note when values depend on Excel or another spreadsheet app recalculating.
