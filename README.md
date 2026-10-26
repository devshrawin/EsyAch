# flowmap

A Claude Code plugin that turns a **codebase** or an **SRS + screenshots** into a single offline HTML
file that looks like an n8n workflow canvas. Its flows are **named and replayable**: data paths in
code, user journeys in a spec.

![Mode A](docs/mode-a.png)

## Install

```
/plugin marketplace add devshrawin/EsyAch
/plugin install flowmap@flowmap
```

Requires Python 3.9+. Nothing else: the viewer ships prebuilt.

## Use

```
/flowmap ./path/to/repo            # Mode A: local path
/flowmap https://github.com/o/r    # Mode A: shallow clone (never executed)
/flowmap ./repo.zip                # Mode A: zip (traversal/zip-bomb safe)
/flowmap spec srs.pdf --screens ./shots   # Mode B (coming in Stage 3)
/flowmap-update                    # re-render after editing in the viewer
```

Output: `.flowmap/architecture.json` and `.flowmap/flowmap.html`. Open the HTML in any browser; it
makes no network requests.

## In the viewer

- **Flows**: pick one to dim everything else, then Play / Step (space, ← →) to follow the data.
- **View & filters**: Overview / Structure / Detail, filter by kind or layer, collapse groups. **Ctrl/Cmd+K** searches.
- **Edit**: drag, rename, reconnect, add or delete nodes and edges, mark items reviewed, build or fix
  flows (Record = click edges). Undo with Ctrl+Z. **Save** downloads `architecture.json` (or an
  HTML with your edits). Then run `/flowmap-update` to re-render without re-analysing.
- **Export**: PNG, SVG (vector), Mermaid, JSON, interactive HTML, Print/PDF (one page per flow).

| Edit mode | Collapsed groups | Vector export |
|---|---|---|
| ![](docs/mode-a-edit.png) | ![](docs/mode-a-groups.png) | ![](docs/mode-a-export.png) |

## Status

Stages 1 and 2 of 4 are done. Mode B (SRS + screenshots) is next. See [docs/PLAN.md](docs/PLAN.md).
Graph format: [docs/schema.md](docs/schema.md).

## Develop

```
python3 scripts/inventory.py examples/shop-demo -o /tmp/inv.json
python3 scripts/validate.py examples/shop-demo/.flowmap/architecture.json --root examples/shop-demo
(cd viewer && npm install && npm run build)     # only after viewer changes
tests/render_examples.sh                        # rebuild, validate, render, screenshot
tests/run_all.sh                                # unit + browser + 600-node perf tests
```
