---
name: Web Page To Markdown
description: Extract readable local or network-enabled HTML pages into clean Markdown with links and source notes.
when_to_use: Use when the user asks to convert a web page or saved HTML file into clean Markdown or text.
tools: Bash(python3:*) Read Write
tags: builtin web html markdown beautifulsoup requests
---

# Web Page To Markdown

Use local HTML first. Network requests require sandbox network access to be explicitly enabled.

Workflow:

1. Fetch or read the page, saving the raw HTML when useful.
2. Extract title, headings, main text, links, images, and tables.
3. Remove navigation and boilerplate only when it is obvious.
4. Preserve source URL or filename and extraction timestamp.
5. Output Markdown with a short extraction quality note.

Do not bypass login, paywalls, or access controls.
