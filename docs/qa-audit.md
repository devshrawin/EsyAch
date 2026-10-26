# flowmap: audit and QA report

**Scope:** the whole plugin as of Stage 4: Python scripts (ingest, inventory, spec extraction,
screenshot prep, coverage, validate, build), the viewer (Mode A and Mode B, editing, exports), packaging,
and both fixtures.
**Method:** a code review of every module (security, correctness, performance), then an automated
QA harness (`tests/qa.py` + `tests/qa_browser.cjs`) with __TOTAL__ test cases run in Chromium, offline.
Every failure was triaged as a **product bug** or a **test bug**, fixed, and the full suite re-run.

## Summary

| Run | Cases | Pass | Fail | Report |
|---|---|---|---|---|
| 1. Baseline (before fixes) | 136 | 126 | 10 | [qa-initial.md](qa-initial.md) |
| 2. After the first fixes | 136 | 134 | 2 | (one regression found, see D7) |
| 3. After the audit fixes | 140 | 139 | 1 | (test-state bug, see T6) |
| **4. Final** | **__TOTAL__** | **__PASS__** | **__FAIL__** | [qa-results.md](qa-results.md) |

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
