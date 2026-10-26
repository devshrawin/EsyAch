# flowmap: build plan

## Architecture (decided)

```
target ──ingest.py──▶ local dir ──inventory.py──▶ inventory.json ──(Claude analyses)──▶ architecture.json
SRS + screens ──spec helpers──▶ spec text + images ──(Claude, vision)──▶ spec.json + screens.json
                                              graph.json ──validate.py──▶ OK ──build.py──▶ flowmap.html
```

- **One schema, one viewer** (`flowmap/1`, `docs/schema.md`). Mode A and B differ only in node kinds
  (`screen`) and in Mode-B-only panels.
- **The viewer is prebuilt and committed** (`viewer/dist/index.html`, React + @xyflow/react + elkjs,
  inlined by vite-plugin-singlefile). `build.py` only injects JSON, so plugin users need Python 3
  and nothing from npm. Contributors run `npm run build` in `viewer/` after changing it.
- **Scripts are Python stdlib.** `ast` for Python, regexes for JS/TS (no tree-sitter, which would
  need native wheels). Go/Java/Ruby/PHP/Rust/C#/Kotlin get a regex fallback for imports, routes and mains.
- **Safety:** no target code is executed. `.gitignore` is parsed by hand: running `git ls-files` on
  a zip or local repo would honour a hostile `.git/config` (`core.fsmonitor`). Clones are shallow and
  run with hooks, LFS and the file protocol disabled. Zips are streamed with caps on total size,
  member count and compression ratio, and traversal or symlink entries are rejected.

## Stages

1. **Schema + viewer + Mode A static map + one flow** ✅
   ingest (path/URL/zip), inventory, validate, build, n8n canvas (dot grid, trigger bolts, hubs with
   ports and dashed circles, "+" stubs, deactivated nodes), flow replay with an animated dot, caption,
   node drawer, edge hover card, minimap, fit, light/dark theme. Fixture `examples/shop-demo`.
2. **Mode A multi-flow:** all entry points covered (signup, login, browse, checkout, payment failure,
   webhook, order status, nightly ETL); dependency view; groups (collapse/expand, auto-grouping
   for 500+ nodes); search (Cmd/Ctrl+K); filters by kind/layer; Overview/Structure/Detail levels.
3. **Mode B:** SRS parsing (PDF/DOCX/MD/TXT), screen understanding with hotspots, spec↔screen
   mapping, journeys, gap report + Coverage panel, screen-card nodes, lightbox with clickable
   hotspots, requirements panel, actor filter, edit mode + "Download updated JSON",
   `/flowmap-update`. Fixture `examples/shop-spec` with a planted gap and contradiction.
4. **Polish:** exports (PNG/SVG/JSON/Mermaid, print-to-PDF, HTML prototype, PDF flow book),
   500-node performance pass, tests (pytest-style stdlib unittest + Playwright), README.
