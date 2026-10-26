---
description: Map a codebase (or an SRS + screenshots) into an interactive n8n-style flow map HTML
argument-hint: <local path | GitHub URL | .zip>   or   spec <srs file> --screens <folder | zip>
allowed-tools: Bash(python3:*), Read, Glob, Grep, Write, Edit
---

Use the **flowmap** skill. Arguments: `$ARGUMENTS`

Scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts`. Never run, install or import anything from the
target, and never upload its code, text or images anywhere.

## Pick the mode

- First word `spec` → **Mode B** (SRS + screenshots). *Not available yet in this version (Stage 3).*
  Tell the user and stop.
- Anything else → **Mode A** (code). The argument is a local path, a git/GitHub URL
  (`https://…`, `owner/repo`) or a `.zip`.

## Mode A

1. **Ingest**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/ingest.py "<target>"` prints `{root, kind, name}`.
   Output dir `OUT`: `<root>/.flowmap` when `kind` is `local`, otherwise `./.flowmap/<name>` in the
   current directory.
2. **Inventory**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/inventory.py <root> -o OUT/inventory.json`
3. **Analyse** following the skill's Mode A rules: read `inventory.json`, then open the files that
   matter. Write `OUT/architecture.json` in the `flowmap/1` schema
   (`${CLAUDE_PLUGIN_ROOT}/docs/schema.md`).
4. **Validate**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/validate.py OUT/architecture.json --root <root>`
   Fix every ERROR and re-run until it prints `OK`. Treat "entry point not covered" warnings as
   missing flows.
5. **Build**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/build.py OUT/architecture.json -o OUT/flowmap.html`
6. **Report** the HTML path, the node/edge/flow counts, the flows by name, any deactivated or dead
   code, and everything you marked `low` confidence. For a temp clone/extract, say where it is.
