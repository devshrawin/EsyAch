---
description: Map a codebase (or an SRS + screenshots) into an interactive n8n-style flow map HTML
argument-hint: <local path | GitHub URL | .zip>   or   spec <srs file> --screens <folder | zip>
allowed-tools: Bash(python3:*), Read, Glob, Grep, Write, Edit
---

Use the **flowmap** skill. Arguments: `$ARGUMENTS`

Scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts`. Never run, install or import anything from the
target, and never upload its code, text or images anywhere.

## Pick the mode

- First word `spec` → **Mode B** (SRS + screenshots): `spec <srs.pdf|.docx|.md|.txt> --screens <folder|.zip>`.
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

## Mode B

`OUT` = `./.flowmap` next to the SRS (create it).

1. **SRS text**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/spec_extract.py <srs> -o OUT/spec_text.json`
   It prints a warning if it finds e-mail addresses or phone numbers that look real. Pass that on to the user.
2. **Screenshots**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/screens_prep.py <folder|zip> -o OUT`
   This writes `OUT/screens_manifest.json` (size, order hint, near-duplicates) and `OUT/grid/*.png`
   (copies with a labelled 10 % grid).
3. **Spec**: read `spec_text.json` and write `OUT/spec.json` following the skill (actors, modules,
   requirements, business rules, validations, notifications, integrations, non-functional).
4. **Screens**: open **every** grid image with the Read tool, then follow the skill's Mode B rules to
   write `OUT/screens.json`: screens, hotspots, transitions, requirement links, journeys and findings.
   Set `project.screens_dir` to the screenshot folder, relative to `OUT`. Warn the user if any screenshot
   seems to show real personal data.
5. **Validate**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/validate.py OUT/screens.json --spec OUT/spec_text.json`
   Fix every ERROR and re-run.
6. **Gaps**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/gaps.py OUT/screens.json --md OUT/coverage.md`
7. **Build**
   `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/build.py OUT/screens.json -o OUT/flowmap.html`
   (add `--theme paper` if the user wants the map for a document or print).
   Screenshots are embedded as WebP at most 1200 px wide; the build warns above 50 MB.
8. **Report**: the HTML path, the coverage %, every requirement without a screen, every contradiction
   and missing state, inferred transitions to confirm, and the journeys.
