---
name: Artifact Packaging
description: Package generated outputs with manifests, checksums, and clear deliverable structure under AITHY_OUTBOX.
when_to_use: Use when the user asks for a final deliverable, zip, bundle, exported folder, or packaged results.
tools: Bash(find:*) Bash(sha256sum:*) Bash(python3:*) Read Write
tags: builtin artifacts packaging manifest checksum outbox
---

# Artifact Packaging

Use this at the end of multi-file work.

Workflow:

1. Collect output files and exclude scratch, cache, and failed intermediate files.
2. Write a manifest with filenames, descriptions, sizes, and checksums.
3. Place final files under `$AITHY_OUTBOX`.
4. Use Python's `zipfile` module when a zip archive is requested.
5. Publish or report the final artifact path.

Never package secrets, credentials, or unrelated workspace files.
