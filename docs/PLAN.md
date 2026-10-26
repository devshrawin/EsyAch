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

### ✅ Stage 3: Mode B (SRS + screenshots)
- `spec_extract.py`: PDF / DOCX / MD / TXT → sections, requirement IDs (FR-, NFR-, REQ-x.y, BR-, US-,
  UC-, SR-) with priority, section and UI flag. Warns about real-looking e-mails, phone and card numbers.
- `screens_prep.py`: folder or zip (safe), sizes, order hints, near-duplicate states (16×16 dHash), and
  gridded copies so vision can read 0-1 hotspot boxes.
- `fm_spec.py` / `gaps.py`: requirements with no screen, screens with no requirement, dead ends,
  unreachable screens, controls that lead nowhere, inferred transitions, findings.
- Viewer: screenshot cards (variants ×n, red/amber badges, requirement chips), self-loop transitions,
  lightbox with clickable hotspots, multi-outcome chooser, Back/breadcrumb, variant tabs, journey
  walkthrough with a pulsing hotspot and the requirement text, Requirements panel (both directions),
  live Coverage panel, actor filter, global-navigation toggle, hotspot editor (draw, move, resize,
  link, delete), screen and requirement-link editing.
- Fixture `examples/shop-spec`: SRS in MD + DOCX + PDF, 8 generated screenshots, planted gap FR-3
  and planted contradiction FR-2. Both are caught.

### ✅ Stage 4: polish, exports, packaging, tests
- Mode B exports: single-file clickable prototype, PDF flow book (coverage + every journey step with
  its screenshot and the highlighted control), screenshots inside the SVG export.
- JS/TS cross-file call graph and NestJS decorator routes in the inventory.
- QA harness `tests/qa.py` + `tests/qa_browser.cjs`. Audit, test cases and results in `docs/QA.md`.

## Known limits
- JS/TS and other non-Python languages are analysed with regexes, so dynamic routing and DI wiring can be missed.
  The model fills gaps from the code and marks them with a confidence level.
- Hotspot boxes on real screenshots come from the model's vision (the grid copies help). The fixture's
  boxes come from the mock generator's DOM, so measure accuracy on your own screens.
- Contradictions between the SRS and the screens are judgement calls by the model. The structural gaps are
  computed.
- ELK runs on the main thread: 600+ nodes lay out in about 1 s. Very large graphs rely on auto-collapsed groups.
- localStorage drafts for `file://` pages are shared by every local HTML file in the same browser profile.
