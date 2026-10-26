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
```

Output: `.flowmap/architecture.json` and `.flowmap/flowmap.html`. Open the HTML in any browser; it
makes no network requests.

## Status

Stage 1 of 4 is done (see [docs/PLAN.md](docs/PLAN.md)). Graph format: [docs/schema.md](docs/schema.md).

## Develop

```
python3 scripts/inventory.py examples/shop-demo -o /tmp/inv.json
python3 scripts/validate.py examples/shop-demo/.flowmap/architecture.json --root examples/shop-demo
(cd viewer && npm install && npm run build)     # only after viewer changes
tests/render_examples.sh                        # rebuild, validate, render, screenshot
```
