# flowmap QA results (latest run)

**84 test cases: 82 pass, 2 fail, 0 skipped.**

| Area | Pass | Fail | Skip |
|---|---|---|---|
| Ingest | 12 | 0 | 0 |
| Inventory | 16 | 1 | 0 |
| Validate | 18 | 0 | 0 |
| SRS | 7 | 1 | 0 |
| Screens | 6 | 0 | 0 |
| Coverage | 8 | 0 | 0 |
| Hotspots | 1 | 0 | 0 |
| Build | 7 | 0 | 0 |
| Packaging | 7 | 0 | 0 |

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
| INV-15 | Express routes detected in JS | GET /health and POST /api/items | AssertionError:  (assert got == [("GET", "/health"), ("POST", "/api/items")] and any(x["reason"] == "commented-out route" for x in d["dead_code"])) | ❌ FAIL |
| INV-16 | Go and Java routes via the regex fallback | Go HandleFunc + gin GET, Spring @PostMapping | ['/orders', '/ping', '/users'] | ✅ PASS |
| INV-17 | Files containing NUL bytes are treated as binary | skipped as binary | {'binary': 1} | ✅ PASS |

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
| VAL-17 | Malformed JSON exits 1 with a message (no traceback) | ERROR cannot read | ERROR cannot read /tmp/flowmap-qa-5mylshm5/bad.json: Expecting property name enc | ✅ PASS |
| VAL-18 | Requirement mapping without a reason is caught | error 'needs a reason' | screen s_signin: requirement FR-1 needs a 'reason' (why this screen satisfies it) | ✅ PASS |

## SRS

| ID | Test case | Expected | Actual | Result |
|---|---|---|---|---|
| SRS-01 | Markdown SRS: 19 requirements with IDs, priority, section | FR-1..FR-16, BR-1, NFR-1..2 | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, BR-1, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, NFR-1, NFR-2 | ✅ PASS |
| SRS-02 | DOCX SRS gives the same IDs, priorities and UI flags as Markdown | identical | 19/19 identical | ✅ PASS |
| SRS-03 | PDF SRS gives the same IDs, priorities and UI flags as Markdown | identical | 19/19 identical | ✅ PASS |
| SRS-04 | Plain-text SRS (numbered headings, no Markdown) | 19 requirements, sections detected | 19 reqs, 7 sections | ✅ PASS |
| SRS-05 | Non-UI requirements flagged | FR-12, NFR-1, NFR-2 ui=false | ['FR-12', 'NFR-1', 'NFR-2'] | ✅ PASS |
| SRS-06 | Real-looking e-mail / phone flagged; example.com ignored | 2 PII hits, masked | AssertionError: [{'kind': 'email', 'value': 'ma…p.io', 'loc': 'line 2'}] (assert kinds == ["email", "phone"] and all("…" in x["value"] for x in d["pii"]), d["pii"]) | ❌ FAIL |
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
| BLD-06 | Template without the data placeholder is refused | SystemExit | template /tmp/flowmap-qa-5mylshm5/tpl.html has no single data placeholder; rebui | ✅ PASS |
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
