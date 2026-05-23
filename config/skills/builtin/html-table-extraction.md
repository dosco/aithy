---
name: HTML Table Extraction
description: Extract tables from local or network-enabled HTML into Markdown, CSV, JSON, or XLSX.
when_to_use: Use when the user provides HTML or asks to extract tables from a page into structured data.
tools: Bash(python3:*) Read Write
tags: builtin html tables beautifulsoup pandas csv json
---

# HTML Table Extraction

Use local files by default. Network access is off unless the sandbox is explicitly configured to allow it.

Workflow:

1. Load the HTML from a local file, pasted content, or an allowed network request.
2. Try `pandas.read_html` for tables.
3. Use BeautifulSoup when tables are irregular or need nearby captions/headings.
4. Preserve source URL or filename, table index, caption, and surrounding heading.
5. Export requested formats and include a table summary.

Respect robots, auth boundaries, and user-provided access limits for network pages.
