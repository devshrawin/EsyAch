---
description: Re-render a flowmap HTML from an edited architecture.json / screens.json, without re-analysing
argument-hint: [path to edited .json | .flowmap dir]   (default: ./.flowmap)
allowed-tools: Bash(python3:*), Read, Glob, Edit
---

Arguments: `$ARGUMENTS`

Use this after someone edited a map in the viewer (Edit → Save downloads `architecture.json` or
`screens.json`), or edited the JSON by hand. **Do not re-run the analysis, and do not overwrite
reviewer edits.**

1. Find the graph:
   - A `.json` path: that file. If it is a fresh download (for example in `~/Downloads`) and a
     `.flowmap/` folder for the same project exists, show the user a short summary of what changed
     (nodes, edges and flows added, removed or edited) and copy it over the old file once they agree.
   - A directory, or nothing: `<dir or ./.flowmap>/architecture.json`, else `screens.json`.
2. Validate:
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/validate.py <graph.json> [--root <source root>]`
   Pass `--root` when the source is available (Mode A: the repo the map was made from). Report errors
   to the user. Fix only mechanical problems yourself, such as a flow step pointing at a deleted
   edge; ask about anything that changes meaning.
3. Build next to the JSON:
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/build.py <graph.json> -o <same dir>/flowmap.html`
4. Report the HTML path and what the reviewer changed. Count items marked `edited` and `confirmed`,
   and items whose evidence is reviewer-only (`{"user": true}`).
