---
name: Spreadsheet Data Analysis
description: Profile, clean, summarize, join, and export spreadsheet data with pandas, openpyxl, and numpy.
when_to_use: Use when the user asks to analyze CSV/XLSX data, summarize rows, clean columns, join files, or export tables.
tools: Bash(python3:*) Read Write
tags: builtin spreadsheet csv xlsx pandas openpyxl numpy analysis
---

# Spreadsheet Data Analysis

Use pandas for table analysis and openpyxl for workbook-specific details.

Workflow:

1. Inspect file type, sheet names, row counts, columns, and missing values.
2. Normalize headers carefully and preserve a mapping to original names.
3. Summarize numeric and categorical columns.
4. Join or filter only after identifying keys and duplicate risks.
5. Export requested outputs to CSV, XLSX, JSON, or Markdown.

For high-stakes financial or legal data, describe extraction and calculations without giving professional advice.
