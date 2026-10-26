# flowmap: audit and QA report

**Scope:** the whole plugin as of Stage 4: Python scripts (ingest, inventory, spec extraction,
screenshot prep, coverage, validate, build), the viewer (Mode A and Mode B, editing, exports), packaging,
and both fixtures.
**Method:** a code review of every module (security, correctness, performance), then an automated
QA harness (`tests/qa.py` + `tests/qa_browser.cjs`) with 140 test cases run in Chromium, offline.
Every failure was triaged as a **product bug** or a **test bug**, fixed, and the full suite re-run.

## Summary

| Run | Cases | Pass | Fail | Report |
|---|---|---|---|---|
| 1. Baseline (before fixes) | 136 | 126 | 10 | [qa-initial.md](qa-initial.md) |
| 2. After the first fixes | 136 | 134 | 2 | (one regression found, see D7) |
| 3. After the audit fixes | 140 | 139 | 1 | (test-state bug, see T6) |
| **4. Final** | **140** | **140** | **0** | [qa-results.md](qa-results.md) |

Done criteria from the brief:

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | HTML opens offline | VA-01, VB-01, VA-16, VB-24, VB-29 (every request blocked; 0 requests, 0 errors) | ✅ |
| 2 | Mode A: at least 3 replayable flows | VA-07 (11 flows, step and play to the end), VAL-01 (0 uncovered entry points) | ✅ |
| 3 | Mode B: at least 2 journeys, clickable hotspots, Coverage catches the gap and the contradiction | VB-05 (5 journeys), VB-06/07/11 (navigation, chooser, walkthrough), VB-15 + COV-01/02 (FR-3 gap, FR-2 contradiction) | ✅ |
| 4 | `validate.py` passes in both modes | VAL-01, VAL-02, plus 16 negative cases proving it catches errors | ✅ |
| 5 | Screenshots match the n8n reference | VA-02..06 check it in the DOM (canvas colour, dot grid, labels under nodes, circles under hubs with dashed lines, red bolts); `docs/compare-mode-a.png` | ✅ |
| 6 | Mode A: zip, URL and local path; Mode B: PDF, DOCX and MD | ING-01..04 (zip inventory identical to the folder; real shallow clone); SRS-01..04 (MD/DOCX/PDF/TXT identical) | ✅ |

## Defects found and fixed

### Product bugs (found by the QA run)

| ID | Severity | Test | Defect | Fix |
|---|---|---|---|---|
| D1 | Medium | INV-15 | A commented-out JS route (`// app.delete(...)`) was counted as a live route. | Skip matches on commented lines; they are reported as dead code. |
| D2 | Medium | SRS-06 | Real phone numbers such as `+44 7700 900123` were not flagged, because a sentence-ending "." broke the match. | New pattern plus a digit-count check. Card numbers are now flagged too (Luhn check). No false positives on the 3 fixture SRS files. |
| D3 | Low | VA-10 | Ctrl+K: Enter did nothing when the mouse rested over the result list (a stale hover index pointed past the filtered results). | Clamp the highlighted index. |
| D4 | High | VB-23 | A saved `screens.json` contained every embedded screenshot (megabytes of base64). | Saved JSON drops `assets` / `view`; `build.py` re-embeds the images. |
| D5 | Medium | SEC-03 | Mermaid export: flow and node names were written raw into `%%` comment lines. A newline or `%%{…}%%` in a label could inject Mermaid statements or directives. | Comment text is sanitised (no newlines, braces or `%`). |
| D6 | Low | (layout review) | Mode B: ELK cycle breaking put screens to the left of the screen before them, so the main journey ran backwards. | Spec mode uses model-order cycle breaking: journeys read left to right. |
| D7 | High | VB-24 | **Regression introduced by the D4 fix:** HTML exports used the same serialiser, so the clickable prototype lost its prototype flag and "Download HTML" in Mode B lost its screenshots. | Separate serialisers: saved JSON is lean, HTML exports stay self-contained. New case VB-29 guards it. |

### Product bugs (found by the code audit, each with a new regression case)

| ID | Severity | Case | Defect | Fix |
|---|---|---|---|---|
| A1 | High | VB-28 | Every edit deep-copied the whole graph into undo history, **including the embedded screenshots**: about 2 MB per edit, up to 200 snapshots (~400 MB) in Mode B. | Snapshots share the immutable `assets` object. Heap growth over 40 edits is now a few MB. |
| A2 | Medium | VB-27 | The Mode B draft autosave wrote the screenshots to localStorage. That goes over the ~5 MB quota, so the save failed silently and unsaved edits were lost on reload. | The draft stores the graph without images; restore re-attaches them. A failed save is logged. |
| A3 | Low | INV-18 | NestJS-style routes (`@Controller('users')` + `@Get()`) in TypeScript were not detected. | Decorator routes with the controller prefix are detected. |

### Test bugs (product was right)

| ID | Test | Problem |
|---|---|---|
| T1 | VA-08 | Compared against "Flows through here", but CSS shows section titles in uppercase. |
| T2 | VA-11 | Expected 4 datastores; the graph has 3 (the queue is a `queue`). It now counts from the graph. |
| T3 | VA-12 | After an earlier failure the page reloaded on another tab; the case now opens its own tab. |
| T4 | VB-02 | A 15-character slice compared with a 14-character string. |
| T5 | VA-09 | Hovered the centre of the edge's bounding box, which for a curve can sit on a neighbouring edge; it now hovers a point on the curve. |
| T6 | VB-25 | Compared the flow book with the journeys as embedded in the file, but an earlier case had (correctly) removed a step and saved; it now checks that every step in the book has its screenshot. |

## Code audit notes (no change needed)

**Security**
- Target code is never executed or installed. Python is parsed with `ast` (no import, no `exec`). No
  `git` command runs on a local or zip target: `.gitignore` is parsed by hand, so a hostile
  `.git/config` (`core.fsmonitor`) cannot run (ING-10).
- Clones are https or SSH only, `--depth 1`, with hooks, LFS smudge and the `file://` protocol off and no submodules.
- Zips: traversal, absolute paths, symlinks, member count, declared and streamed size, and compression
  ratio are all checked; nested archives are never extracted (ING-05..08, ING-12, SCR-05). Images are
  capped at 60 MP (decompression bombs).
- The viewer has no `innerHTML` / `dangerouslySetInnerHTML` / `eval`. React escapes all text (SEC-01).
  SVG, print book and Mermaid exports escape (SEC-03). Embedded JSON escapes `</script>` and `<!--`
  (BLD-02). Images are accepted only as `data:image/…` from the file itself, never URLs (SEC-02).
  Image paths cannot escape the screens folder (BLD-07). Evidence paths cannot escape `--root`.
- Nothing is uploaded: the HTML makes zero network requests (checked with every request blocked).

**Known limits (documented, not defects)**
- JS/TS and other languages use regex analysis: dynamic route tables, DI wiring and meta-programming
  can be missed. The model fills gaps from the code with confidence levels.
- Hotspot boxes on real screenshots come from the model's vision (gridded copies help). The fixture's
  boxes come from the mock generator's DOM (HS-01 checks them; VB-09 checks they render within 2 px).
- Contradictions are judgement calls by the model, with evidence. Structural gaps are computed.
- ELK layout runs on the main thread (about 1 s at 646 nodes, PRF-01). Bigger graphs rely on
  auto-collapsed groups.
- In Chromium, localStorage for `file://` pages is shared by every local HTML file in the profile, so
  a draft could be read by another local page you open. Drafts never leave the machine.
- Mode B fixture: `role_customer` / `role_admin` tabs are modelled as in-place controls. The Sign in
  button's destination depends on the role (shown as a chooser).

## How to reproduce

```
python3 tests/qa.py                  # all cases -> docs/qa-results.md / .json
python3 tests/qa.py --no-network     # skip the GitHub clone cases
python3 -m unittest discover -s tests -p 'test_*.py'
```

---

# Test cases (final run)
**140 test cases: 140 pass, 0 fail, 0 skipped.**

| Area | Pass | Fail | Skip |
|---|---|---|---|
| Ingest | 12 | 0 | 0 |
| Inventory | 18 | 0 | 0 |
| Validate | 18 | 0 | 0 |
| SRS | 8 | 0 | 0 |
| Screens | 6 | 0 | 0 |
| Coverage | 8 | 0 | 0 |
| Hotspots | 1 | 0 | 0 |
| Build | 7 | 0 | 0 |
| Packaging | 7 | 0 | 0 |
| Viewer A | 22 | 0 | 0 |
| Viewer B | 29 | 0 | 0 |
| Performance | 1 | 0 | 0 |
| Security | 3 | 0 | 0 |

## Ingest

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| ING-01 | Local path resolves to itself | kind=local, root = the folder | kind=local | ✅ PASS |
| ING-02 | Zip input: extracted, single top folder unwrapped, same inventory as the folder | same entry points / calls as the local path | 14 entry points, 37 calls (identical) | ✅ PASS |
| ING-03 | GitHub URL: shallow clone then inventory | clone succeeds, inventory runs | cloned, depth=1, 1 file(s) | ✅ PASS |
| ING-04 | owner/repo shorthand expands to a GitHub https URL | url=https://github.com/o/r.git | https://github.com/octocat/Spoon-Knife.git | ✅ PASS |
| ING-05 | Zip with ../ path traversal is rejected | UnsafeArchive, nothing written outside | rejected: path traversal in archive: '../escape.txt' | ✅ PASS |
| ING-06 | Zip with an absolute path is rejected | UnsafeArchive | rejected: absolute path in archive: '/tmp/abs.txt' | ✅ PASS |
| ING-07 | Zip bomb (high compression ratio) is rejected | UnsafeArchive before extraction | rejected: suspicious compression ratio for 'a.txt' | ✅ PASS |
| ING-08 | Zip containing a symlink entry is rejected | UnsafeArchive | rejected: symlink in archive: 'link' | ✅ PASS |
| ING-09 | Non-https URLs (http://, file://) are refused | SystemExit, no clone | both refused | ✅ PASS |
| ING-10 | A hostile .git/config (core.fsmonitor) in the target is never executed | inventory runs, the marker file is not created | marker absent | ✅ PASS |
| ING-11 | Missing path gives a clear error | exit != 0 with a message | target not found and not a recognised git URL: /nope/does-not-exist | ✅ PASS |
| ING-12 | Zip with too many entries is rejected | UnsafeArchive | too many entries (30 > 10) | ✅ PASS |

## Inventory

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| INV-01 | All 7 FastAPI routes found (incl. the flag-guarded one) | 7 http/webhook entry points | POST /api/users, POST /api/login, GET /api/products, POST /api/orders, GET /api/orders/{order_id}, POST /api/webhooks/stripe, POST /api/orders/{order_id}/refund | ✅ PASS |
| INV-02 | Webhook route classified as webhook | POST /api/webhooks/stripe kind=webhook | /api/webhooks/stripe | ✅ PASS |
| INV-03 | Cron job read from ops/crontab | schedule 0 2 * * * with the command | 0 2 * * * cd /app && python -m jobs.nightly | ✅ PASS |
| INV-04 | Feature-flagged route marked deactivated with flag evidence | status=deactivated, default False, config.py:11 | ENABLE_LEGACY_REFUNDS default=False | ✅ PASS |
| INV-05 | Commented-out route reported as dead code | DELETE /api/orders/{order_id} @ main.py:62 | DELETE /api/orders/{order_id} | ✅ PASS |
| INV-06 | Code reachable only from deactivated code is flagged | legacy_refund flagged | legacy_refund | ✅ PASS |
| INV-07 | Python call graph resolves across modules | checkout -> orders.create_order | 37 call edges | ✅ PASS |
| INV-08 | JS/TS cross-file calls resolved | 4 page -> api.ts calls | onPay->placeOrder, OrderStatus->getOrder, Products->listProducts, onSubmit->signup | ✅ PASS |
| INV-09 | fetch() calls with HTTP method | POST /users, GET /products, POST /orders, GET /orders/{id} | [('GET', '${BASE}/orders/${id}'), ('GET', '${BASE}/products'), ('POST', '${BASE}/orders'), ('POST', '${BASE}/users')] | ✅ PASS |
| INV-10 | Env vars incl. required os.environ[...] | 8 vars, STRIPE_SECRET_KEY required | DATABASE_URL, REDIS_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SMTP_HOST, ENABLE_LEGACY_REFUNDS, REPORT_DIR, VITE_API_URL | ✅ PASS |
| INV-11 | SDKs detected; SMTP send not misread as a queue | Stripe + SMTP externals; no smtp in queues | ['SMTP', 'Stripe'] | ✅ PASS |
| INV-12 | .gitignore, lockfiles, node_modules, binaries and >1 MB files skipped | only a.py, keep.log, .gitignore kept | kept ['.gitignore', 'a.py', 'keep.log'], skipped {'skipped_dir': 1, 'gitignored': 2, 'over_1mb': 1, 'binary': 1, 'lockfile': 1} | ✅ PASS |
| INV-13 | Symlinks are not followed (no escape from the repo) | a symlink to /etc is skipped | skipped={'symlink': 2} | ✅ PASS |
| INV-14 | A file with a syntax error does not crash the inventory | parse_error recorded, others analysed | invalid syntax (line 1) | ✅ PASS |
| INV-15 | Express routes detected in JS | GET /health and POST /api/items | [('GET', '/health'), ('POST', '/api/items')] | ✅ PASS |
| INV-16 | Go and Java routes via the regex fallback | Go HandleFunc + gin GET, Spring @PostMapping | ['/orders', '/ping', '/users'] | ✅ PASS |
| INV-17 | Files containing NUL bytes are treated as binary | skipped as binary | {'binary': 1} | ✅ PASS |
| INV-18 | NestJS decorator routes in TypeScript (audit finding A3) | GET /users, POST /users/:id/ban | [('GET', '/users'), ('POST', '/users/:id/ban')] | ✅ PASS |

## Validate

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| VAL-01 | Mode A fixture validates with evidence checked against source | OK, 0 errors, 0 warnings | OK: 20 nodes, 23 edges, 11 flows | ✅ PASS |
| VAL-02 | Mode B fixture validates (images, boxes, requirement IDs vs SRS) | OK, 0 errors | OK, 0 warnings | ✅ PASS |
| VAL-03 | Flow step using an edge that leads elsewhere is caught | error 'goes to' | flow[0] checkout step 3: edge e_ui_signup goes to 'ep_signup', not 'hub_orders' | ✅ PASS |
| VAL-04 | Evidence line beyond end of file is caught | error 'beyond end of file' | node[0] ui_storefront: evidence web/src/api.ts:9999 beyond end of file (32 lines) | ✅ PASS |
| VAL-05 | Evidence pointing at a missing file is caught | error 'evidence file not found' | node[0] ui_storefront: evidence file not found: nope.py | ✅ PASS |
| VAL-06 | Inferred edge with high confidence / no reason is rejected | two errors | edge[0] e_ui_signup: inferred edges cannot be high confidence | ✅ PASS |
| VAL-07 | Orphan node is caught | error 'orphan' | node lonely: orphan (no edges) | ✅ PASS |
| VAL-08 | Circle attached to an undeclared hub port is caught | error 'not declared on hub' | node ds_postgres: port 'Nope' not declared on hub 'hub_orders' | ✅ PASS |
| VAL-09 | Hotspot box outside 0-1 is caught | error 'box must be' | screen s_signin hotspot role_customer: box must be [x, y, w, h] in 0-1 and inside the image, got [0.9, 0.5, 0.3, 0.1] | ✅ PASS |
| VAL-10 | Unknown requirement reference is caught | error 'unknown requirement' | edge e_signin_products: unknown requirement 'FR-999' | ✅ PASS |
| VAL-11 | Missing screenshot file is caught | error 'image not found' | screen s_signin: image not found: /home/user/EsyAch/examples/shop-spec/screens/missing.png | ✅ PASS |
| VAL-12 | Journey step with an unknown variant is caught | error 'variant' | flow j_signin_fail step 2: variant 'nope' does not exist on s_signin | ✅ PASS |
| VAL-13 | Self-loop edges are rejected in Mode A | error 'self-loop' | edge[23] loop: self-loop (only Mode B navigate edges may return to the same screen) | ✅ PASS |
| VAL-14 | An action step that changes screen is rejected | error 'must stay' | flow[4] j_admin step 3: an action step without an edge must stay on the previous step's node | ✅ PASS |
| VAL-15 | Requirement not present in the SRS extraction is caught (--spec) | error 'not in the SRS' | requirement FR-77: not in the SRS extraction (spec.json) | ✅ PASS |
| VAL-16 | Duplicate node ids are caught | error 'duplicate id' | node[20] ui_storefront: duplicate id | ✅ PASS |
| VAL-17 | Malformed JSON exits 1 with a message (no traceback) | ERROR cannot read | ERROR cannot read /tmp/flowmap-qa-sxc60roj/bad.json: Expecting property name enc | ✅ PASS |
| VAL-18 | Requirement mapping without a reason is caught | error 'needs a reason' | screen s_signin: requirement FR-1 needs a 'reason' (why this screen satisfies it) | ✅ PASS |

## SRS

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| SRS-01 | Markdown SRS: 19 requirements with IDs, priority, section | FR-1..FR-16, BR-1, NFR-1..2 | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, BR-1, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, NFR-1, NFR-2 | ✅ PASS |
| SRS-02 | DOCX SRS gives the same IDs, priorities and UI flags as Markdown | identical | 19/19 identical | ✅ PASS |
| SRS-03 | PDF SRS gives the same IDs, priorities and UI flags as Markdown | identical | 19/19 identical | ✅ PASS |
| SRS-04 | Plain-text SRS (numbered headings, no Markdown) | 19 requirements, sections detected | 19 reqs, 7 sections | ✅ PASS |
| SRS-05 | Non-UI requirements flagged | FR-12, NFR-1, NFR-2 ui=false | ['FR-12', 'NFR-1', 'NFR-2'] | ✅ PASS |
| SRS-06 | Real-looking e-mail / phone flagged; example.com ignored | 2 PII hits, masked | [{'kind': 'email', 'value': 'ma…p.io', 'loc': 'line 2'}, {'kind': 'phone', 'value': '+4…0123', 'loc': 'line 2'}] | ✅ PASS |
| SRS-07 | Dotted IDs like REQ-3.2 and US-4 extracted | REQ-3.2, US-4 | ['REQ-3.2', 'US-4'] | ✅ PASS |
| SRS-08 | Unsupported SRS format refused | SystemExit | unsupported SRS format: .rtf (PDF, DOCX, MD or TXT) | ✅ PASS |

## Screens

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| SCR-01 | All 8 screenshots read with size and order | 8 images 1280x800, order 1..8 | 8 images | ✅ PASS |
| SCR-02 | Near-duplicates: exactly the sign-in / sign-in-error pair | only 01<->02 | 01 <-> 02 only | ✅ PASS |
| SCR-03 | Gridded copies written for vision | 8 grid PNGs | 8 grid images | ✅ PASS |
| SCR-04 | Zip of screenshots: images extracted, other files ignored | 8 images, readme ignored | 8 images, no scripts extracted | ✅ PASS |
| SCR-05 | Screenshot zip with traversal rejected | SystemExit unsafe archive | unsafe archive rejected: path traversal in archive: '../../x.png' | ✅ PASS |
| SCR-06 | Corrupt image reported, not a crash | error entry for the bad file | bad.png -> error, ok.png processed | ✅ PASS |

## Coverage

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| COV-01 | Planted gap: FR-3 (password reset) has no screen | requirements_without_screen == [FR-3] | FR-3 | ✅ PASS |
| COV-02 | Planted contradiction: FR-2 (8 vs 6 characters) reported + red badge on Sign in | contradiction F1 on s_signin | Password rule: the SRS says at least 8 characters, the sign-in screen says 'Minimum 6 characters'. | ✅ PASS |
| COV-03 | 'Forgot password?' detected as a control that leads nowhere | 1 dead hotspot | Forgot password? | ✅ PASS |
| COV-04 | Dead-end screen detected | s_status becomes a dead end when its exits are removed | ['s_status'] | ✅ PASS |
| COV-05 | Unreachable screen detected | s_admin unreachable when sign-in -> admin is removed | ['s_admin'] | ✅ PASS |
| COV-06 | Screen with no requirement detected | s_status flagged when its mapping is removed | s_status | ✅ PASS |
| COV-07 | Non-UI requirements excluded from the coverage denominator | 15/16 covered (FR-12, NFR-1/2 excluded) | 15/16 | ✅ PASS |
| COV-08 | gaps.py Markdown report lists the planted gap and contradiction | FR-3 and FR-2 in report | - UI requirements covered by a screen: **15/16 (94 %)** | ✅ PASS |

## Hotspots

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| HS-01 | Every hotspot matches the true element box (IoU >= 0.9) | all hotspots, all variants | 52 hotspots, worst IoU 1.000 | ✅ PASS |

## Build

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| BLD-01 | Mode A HTML has no external script/style/image/font references | 0 http(s) src/href, no @import url(http | 2002 KB, 0 external refs | ✅ PASS |
| BLD-02 | Graph text containing </script> and <!-- cannot break out of the data tag | escaped as <\/script> <\!-- | data tag intact, JSON round-trips | ✅ PASS |
| BLD-03 | Mode B screenshots embedded as WebP, max 1200 px wide | 8 data:image/webp assets, width <= 1200 | 8 images, widths [1200] | ✅ PASS |
| BLD-04 | Output above the size limit prints a warning | WARNING ... larger than | WARNING: output is larger than 0 MB; consider fewer/smaller screenshots | ✅ PASS |
| BLD-05 | Missing screenshot -> warning, build still succeeds | WARNING not found; HTML written | WARNING: 1 screenshot(s) not found in /home/user/EsyAch/examples/shop-spec/screens: ['gone | ✅ PASS |
| BLD-06 | Template without the data placeholder is refused | SystemExit | template /tmp/flowmap-qa-sxc60roj/tpl.html has no single data placeholder; rebui | ✅ PASS |
| BLD-07 | Mode B images cannot be read from outside the screens folder | ../ path not embedded | refused | ✅ PASS |

## Packaging

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| PKG-01 | plugin.json is valid with name/version/description | flowmap 0.x | flowmap 0.1.0 | ✅ PASS |
| PKG-02 | marketplace.json lists plugin 'flowmap' in marketplace 'flowmap' (install flowmap@flowmap) | source ./ | flowmap@flowmap | ✅ PASS |
| PKG-03 | Commands and skill have frontmatter | description in each; skill name=flowmap | 3/3 | ✅ PASS |
| PKG-04 | Every script referenced by the commands exists | all present | build.py, gaps.py, ingest.py, inventory.py, screens_prep.py, spec_extract.py, validate.py | ✅ PASS |
| PKG-05 | Prebuilt viewer is newer than every viewer source file | dist mtime >= src mtimes | up to date | ✅ PASS |
| PKG-06 | Scripts import only the stdlib (Pillow/pypdf optional, guarded) | no other third-party imports | stdlib + optional PIL/pypdf | ✅ PASS |
| PKG-07 | README documents install, both modes, editing and exports | all keywords present | ok | ✅ PASS |

## Viewer A

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| VA-01 | Opens offline: no network requests, no console errors | 0 requests, 0 errors | 20 nodes rendered | ✅ PASS |
| VA-02 | n8n look: charcoal canvas background | rgb(42, 42, 42) | rgb(42, 42, 42) | ✅ PASS |
| VA-03 | n8n look: dot grid | background pattern of dots | dot pattern present | ✅ PASS |
| VA-04 | n8n look: labels sit under the node box | label top >= box bottom for every square node | 12 nodes checked | ✅ PASS |
| VA-05 | n8n look: circles under hubs, joined by dashed lines | every circle below its hub; dashed dependency strokes | 5 circles under hubs, dasharray 5px, 5px | ✅ PASS |
| VA-06 | n8n look: red trigger bolts on entry points | bolt fill = accent red on every trigger | 8 bolts, rgb(255, 109, 90) | ✅ PASS |
| VA-07 | At least 3 replayable flows: select, step, play | 11 flows; caption advances; play reaches the end | 11 flows, caption 2/10 -> 10/10, animated dot 1 | ✅ PASS |
| VA-08 | Node drawer shows summary, evidence, edges, flows | drawer lists file:line and flows | evidence + flows listed | ✅ PASS |
| VA-09 | Edge hover card shows payload and evidence | payload + file:line | Storefront → Checkout http sync main high confidence Action: POST Payload: {user_id, items | ✅ PASS |
| VA-10 | Ctrl+K search finds a node by symbol name | typing 'create_order' opens Order Service | Order Service | ✅ PASS |
| VA-11 | Detail levels and kind filter change what is drawn | Overview < Detail nodes; hiding datastores removes them | detail 20, overview 15, without datastores 17 | ✅ PASS |
| VA-12 | Groups collapse into a stacked card and expand on click | 4 group cards; click expands one | 4 -> 3 | ✅ PASS |
| VA-13 | Edit a label, undo, redo | label changes; Ctrl+Z restores; Ctrl+Shift+Z re-applies | edit / undo / redo ok | ✅ PASS |
| VA-14 | Connect two nodes by dragging handles; drag a node | edge count +1; node keeps the dragged position | edges 23 -> 24, node moved 87 px | ✅ PASS |
| VA-15 | Save JSON contains the edits (edited flag, reviewer evidence, pos) | label, new edge, pos saved; no view-only fields | architecture.json | ✅ PASS |
| VA-16 | Download HTML with edits re-opens offline with the edits | edited label visible, 0 requests | shop-demo.flowmap.html | ✅ PASS |
| VA-17 | Exports: PNG, vector SVG, Mermaid, JSON | valid files | PNG 887 KB, SVG 27 KB, Mermaid 68 lines | ✅ PASS |
| VA-18 | Print / PDF book: overview + one section per flow | 11 flow sections with tables | 11 sections | ✅ PASS |
| VA-19 | Light theme toggle | canvas turns light | rgb(244, 244, 246) | ✅ PASS |
| VA-20 | Unsaved edits survive a reload (draft restore) | banner offers Restore; restore brings the edit back | restored | ✅ PASS |
| VA-21 | Deactivated route shown dimmed with '(Deactivated)' | label suffix + reduced opacity | opacity 0.45 | ✅ PASS |
| VA-22 | Minimap and controls rendered; fit view keeps all nodes on screen | minimap present; all nodes in viewport | all nodes visible | ✅ PASS |

## Viewer B

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| VB-01 | Mode B opens offline with no errors | 0 requests, 0 errors | 7 screen cards | ✅ PASS |
| VB-02 | Screen cards show the embedded screenshot thumbnail | 7 <img> with data:image/webp | 7 thumbnails decoded | ✅ PASS |
| VB-03 | Variants: stacked card with ×2 badge on Sign in | ×2 on s_signin only | ×2 | ✅ PASS |
| VB-04 | Gap badges: red + amber on Sign in, amber on Checkout | s_signin 1 red 1 amber; s_checkout 1 amber | badges ok | ✅ PASS |
| VB-05 | At least 2 journeys, per actor | 5 journeys; actors Customer and Admin | 5 journeys (1 for Admin) | ✅ PASS |
| VB-06 | Clicking hotspots navigates between screens; breadcrumb + Back | Cart -> Checkout -> Order confirmed; Back returns | Cart › Checkout › Order confirmed, back -> Checkout (chooser shown: true) | ✅ PASS |
| VB-07 | One control, several destinations: chooser (Sign in by role) | 3 options; picking Admin opens Order Management | 3 options | ✅ PASS |
| VB-08 | Dead control explains the gap; in-place control explains itself | 'leads nowhere' / 'stays on this screen' | "Forgot password?" leads nowhere in these screenshots (coverage gap). / "Admin" stays on this screen: selects the Admin role. | ✅ PASS |
| VB-09 | Hotspot rectangles sit exactly on the screenshot controls | Sign in hotspot within 2 px of its 0-1 box | offset 0.0 px, width error 0.0 px | ✅ PASS |
| VB-10 | Variant switch shows the error state image and its hotspots | Error tab -> 02-sign-in-error.png | 02-sign-in-error.png | ✅ PASS |
| VB-11 | Journey walkthrough: pulsing hotspot, clicking it advances | step 1 pulses 'Sign in'; click -> step 2 Products | pulse=sign_in, now step 2 on Products | ✅ PASS |
| VB-12 | Walkthrough Play auto-advances with requirement text | reaches Order status with FR-13 shown | step 6/6, FR-13 shown | ✅ PASS |
| VB-13 | Requirements panel: picking FR-8 lights up the Cart screen and dims the rest | Cart in-flow, others dimmed | Cart highlighted, Order Management dimmed | ✅ PASS |
| VB-14 | Reverse lookup: requirement chip in a screen focuses that requirement | clicking FR-13 in Order status focuses FR-13 | FR-13 | ✅ PASS |
| VB-15 | Coverage panel catches the planted gap and contradiction | FR-3 under 'no screen'; FR-2 contradiction | 15/16 covered; FR-3 gap; FR-2 contradiction | ✅ PASS |
| VB-16 | Actor filter Admin shows only the Admin's screens | Sign in + Order Management | s_admin, s_signin | ✅ PASS |
| VB-17 | Inferred transition drawn dashed with a '?' badge | e_products_status dashed + ? | react-flow__edge-path fm-edge is-inferred in-flow, 1 '?' badges | ✅ PASS |
| VB-18 | Self-loop transitions drawn (sign-in error, card declined) | 2 loop edges rendered | 2 loops | ✅ PASS |
| VB-19 | Global navigation hidden by default, toggle shows it | edge count rises when enabled | 13 -> 25 edges | ✅ PASS |
| VB-20 | Search finds a requirement | 'FR-13' focuses it in the Requirements tab | FR-13 | ✅ PASS |
| VB-21 | Edit mode: draw a hotspot, link it, coverage updates live | new hotspot + edge; dead-control count drops after linking 'Forgot password?' | hotspots 5 -> 6, linked; Sign in amber badge cleared | ✅ PASS |
| VB-22 | Edit mode: move a hotspot by dragging; delete a hotspot removes its links | box changes; edge removed | moved 60 px; edges 32 -> 31 | ✅ PASS |
| VB-23 | Saved screens.json carries hotspot edits | new hotspot + user-evidence edge present | edits saved; embedded images not duplicated into the JSON | ✅ PASS |
| VB-24 | Exported clickable prototype opens straight into the screens and navigates | prototype bar; hotspot click navigates; offline | 2147 KB, Sign in -> Products | ✅ PASS |
| VB-25 | Flow book: coverage + every journey step with its screenshot and highlighted hotspot | img per step; hotspot boxes; FR text | 22/22 step screenshots | ✅ PASS |
| VB-29 | Mode B 'Download HTML with edits' keeps the embedded screenshots | re-opened file shows 7 thumbnails | 7 thumbnails, 2.1 MB | ✅ PASS |
| VB-26 | SVG export embeds the screenshots | <image href=data:image/webp ...> per screen | 7 images | ✅ PASS |
| VB-27 | Unsaved Mode B edits survive a reload (audit finding A2) | draft fits storage; restore keeps edits and images | restored with screenshot | ✅ PASS |
| VB-28 | Edit history does not copy screenshots per edit (audit finding A1) | heap grows < 25 MB over 40 edits | heap +0.0 MB after 40 edits | ✅ PASS |

## Performance

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| PRF-01 | 600+ node graph: first render, expand all, select flow | each under 3 s; no errors | first 1814 ms (12 groups collapsed), expand 1262 ms, flow 1108 ms | ✅ PASS |

## Security

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| SEC-01 | HTML in labels is shown as text, never executed | no script runs from a node label / summary | rendered as text | ✅ PASS |
| SEC-02 | Screens can only use embedded images; a URL in assets is ignored | no request to the URL; card shows placeholder | no network request | ✅ PASS |
| SEC-03 | Exports escape user text (SVG, Mermaid, print book) | no raw <script> / quotes break out | SVG, Mermaid and book escaped | ✅ PASS |
