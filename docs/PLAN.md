# flowmap: plan and status

## Architecture (decided)

```
target ──ingest.py──▶ local dir ──inventory.py──▶ inventory.json ──(Claude analyses)──▶ architecture.json
SRS + screens ──spec helpers──▶ spec text + images ──(Claude, vision)──▶ spec.json + screens.json
                                              graph.json ──validate.py──▶ OK ──build.py──▶ flowmap.html
edited in the viewer ──Save──▶ architecture.json ──/flowmap-update──▶ validate + build (no re-analysis)
```

- **One schema, one viewer** (`flowmap/1`, `docs/schema.md`).
- **The viewer is prebuilt and committed** (`viewer/dist/index.html`: React + @xyflow/react + elkjs,
  inlined by vite-plugin-singlefile). Plugin users need only Python 3.
- **Scripts are Python stdlib.** `ast` for Python, regexes for JS/TS, and a regex fallback for other languages.
- **Safety:** target code is never executed. `.gitignore` is parsed by hand. Clones are shallow and run
  without hooks or LFS. Zips are capped on size, member count and compression ratio, and traversal
  or symlink entries are rejected.
- **Editing saves by download.** A page opened from disk cannot write files. Chrome/Edge show a native
  "Save as" (File System Access API); other browsers download. Unsaved edits are kept in
  localStorage and offered back after a reload.

## Status

### ✅ Stage 1: schema, n8n viewer, Mode A static map + one flow
ingest (path / URL / zip, safe), inventory, validate, build. Canvas: dot grid, trigger bolts, hubs
with ports and dashed circles, "+" stubs, deactivated nodes, minimap, fit, light/dark. Flow replay
with an animated dot, caption, node drawer, edge hover card.

### ✅ Stage 2: Mode A complete + editing + exports
- 11 flows cover every entry point in `examples/shop-demo`: happy paths, failures (402, 409, 401),
  alternate (cache miss), side effect (webhook) and scheduled (nightly ETL). Validates with 0 warnings.
- Flow tab: actor filter, flow kinds, play/pause/step, step list in sync.
- View tab: Overview / Structure / Detail levels, dependency and deactivated toggles, filters by
  node kind and layer, groups (collapse or expand each, or all), auto-grouping by folder for big graphs.
- Search (Ctrl/Cmd+K) across nodes, files, symbols, flows and groups.
- **Edit mode:** drag nodes, edit any node or edge field, add a node, connect by dragging handles,
  delete, reverse, mark reviewed, mark inferred. Edit flows: rename, add steps from a list or by
  clicking edges (Record), reorder, delete. Undo/redo, live checks (⚠ n), draft autosave.
- **Save:** JSON (native Save As where supported) and a self-contained HTML with the edits baked in.
  `/flowmap-update` re-renders from the JSON without re-analysing.
- **Export:** PNG (2×), SVG (real vector shapes and text), Mermaid, JSON, interactive HTML, and
  Print/PDF book (overview map plus one page per flow with its highlighted map and step table).
- Scale: 646 nodes render in about 1 s, with lazy labels by zoom and only visible elements drawn above 200 nodes.
- Tests: `tests/run_all.sh` runs 11 unit tests, a 25-check browser test and the 600-node perf check.

### ⏳ Stage 3: Mode B (SRS + screenshots)
SRS parsing (PDF/DOCX/MD/TXT → spec.json with requirement IDs), screenshot understanding with hotspot
boxes, screen↔requirement mapping, journeys per actor, gap report (missing screens, orphan screens,
dead ends, unreachable screens, contradictions). Viewer: screen-card nodes with thumbnails, variants,
gap badges, Coverage panel, lightbox with clickable hotspots, back button and breadcrumb, journey
walkthrough, requirements panel. Hotspot editing (draw, adjust, link) reuses the Stage 2 editor.
Fixture `examples/shop-spec` with a planted gap and a planted contradiction.

### ⏳ Stage 4: polish and packaging
Mode B exports (single-file clickable prototype, PDF flow book with screenshots), JS/TS call-graph
depth, the README walkthrough, and checking every done-criterion end to end (URL/zip/path for Mode A;
PDF/DOCX/MD for Mode B; screenshots vs. reference).
