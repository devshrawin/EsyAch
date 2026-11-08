# SRS pages

An SRS page explains a requirements document to the people who build, test, and sign it off. It answers three questions in this order: what does the system do, does every requirement have a screen, and what must change before the build. Scripts collect the facts, you write a small model, and the renderer draws the tables, gaps, journeys, and prototype from it. The page is never a copy of the document.

## Pipeline

```sh
T=<this skill's directory>/tools
python3 $T/extract_srs.py <srs.pdf|docx|md|txt> -o <out>/.esyach/srs_text.json   # sections, requirement IDs, PII warnings
python3 $T/screens_prep.py <screens dir|zip> -o <out>/.esyach                    # optional: manifest, grid/ copies, web/ copies
# you: view every grid/*.png, then write .esyach/srs.json and .esyach/srs.src.html
node <this skill's directory>/kit/render.mjs <out>/.esyach/srs.src.html          # checks the model, draws, looks at the page
```

`<out>` is the folder that holds the SRS unless the user names another. PDF needs `pypdf` or `pdftotext`; screenshots need Pillow. An SRS without IDs still works: `extract_srs.py` numbers every shall/must/should statement `R-001`, `R-002`, … and marks them `auto`; say so on the page. If the extraction prints a PII warning, or a screenshot shows real names, e-mails, or card numbers, tell the user before anything is shared.

## The model: `srs.json`

Requirements are never written here: the renderer reads them from the extraction, so the page cannot carry one the SRS does not. Everything else is yours, and every claim is grounded in what the SRS says or a screenshot shows.

```json
{
  "schema": "esyach-srs/1",
  "project": { "name": "ShopDemo", "source": "srs.md", "version": "1.2", "summary": "One sentence." },
  "extraction": "srs_text.json", "manifest": "screens_manifest.json", "screens_dir": "../screens", "images": "web",
  "ui_overrides": { "FR-12": false },
  "actors":  [{ "id": "customer", "label": "Customer", "description": "…" }],
  "modules": [{ "id": "auth", "label": "Authentication", "summary": "…", "reqs": ["FR-1", "FR-2"] }],
  "screens": [{
    "id": "sign-in", "label": "Sign in", "image": "01-sign-in.png", "state": "default", "entry": true,
    "actors": ["customer"], "purpose": "…",
    "reqs": [{ "id": "FR-1", "reason": "Email and Password fields and a Sign in button", "confidence": "high" }],
    "hotspots": [{ "id": "sign-in", "label": "Sign in", "kind": "button", "box": [0.355, 0.69, 0.073, 0.055] },
                 { "id": "tab-admin", "label": "Admin", "kind": "tab", "box": […], "in_place": true, "note": "picks the role" }],
    "variants": [{ "id": "error", "label": "Invalid credentials", "image": "02-sign-in-error.png", "state": "error", "hotspots": […] }]
  }],
  "links": [{ "from": "sign-in", "hotspot": "sign-in", "to": "products", "label": "Sign in", "condition": "role Customer", "reqs": ["FR-5"] },
            { "from": "sign-in", "hotspot": "sign-in", "to": "sign-in", "to_variant": "error", "condition": "wrong password" },
            { "from": "cart", "hotspot": "nav-orders", "to": "order-status", "inferred": true, "confidence": "low", "reason": "no order list is shown", "global": true }],
  "journeys": [{ "id": "buy", "name": "A customer places an order", "actor": "customer", "kind": "happy",
                 "steps": [{ "screen": "sign-in", "hotspot": "sign-in", "text": "Jane signs in as a Customer.", "req": "FR-5" }] }],
  "findings": [{ "id": "f1", "type": "contradiction", "severity": "high", "req": "FR-2", "screen": "sign-in", "hotspot": "password",
                 "text": "The form asks for 6 characters; the SRS asks for 8", "srs_says": "…", "screen_shows": "…" }]
}
```

- **Screens.** View every `grid/` copy: the 10% grid gives 0–1 boxes `[x, y, w, h]`. Record **every** visible control. `kind`: `button link tab menu field toggle checkbox image other`. A control that acts without leaving the screen gets `in_place: true` and a `note`. Near-duplicates in the manifest are one screen with `variants`. `state`: `default empty filled error success modal loading`.
- **Mapping.** Each `reqs` entry on a screen has a `reason` naming what is visible: a label, a heading, button text.
- **Links.** A transition the SRS states or the screenshots show is a plain link. One that neither shows is `inferred: true` with a `reason`. A control with several outcomes gets one link per outcome with a `condition`. A control whose destination nobody knows gets no link: coverage lists it.
- **Journeys** per actor: the happy path, then failure and alternate paths the SRS describes. Each step names the screen, the control pressed to leave it (`hotspot`), one sentence of `text` in present tense, and the `req` it shows. `variant` shows another state of the screen.
- **Findings** are judgement: `contradiction` (with `srs_says` and `screen_shows`), `missing_state` (the SRS describes a state no screenshot shows), `ambiguity` (the SRS can be read two ways or cannot be tested), `note`. Structural gaps are **computed** and never written: requirements with no screen, controls that lead nowhere, unreachable screens, screens with no requirement, inferred links.
- **No screenshots?** Leave `screens`, `links`, `journeys` empty. The page still explains the SRS (context, modules, trace, rules, findings); coverage then counts every UI requirement as without a screen, so say "no screens supplied" instead of showing the percentage as a verdict.

The renderer rejects the model with errors that name the JSON path: unknown IDs, boxes outside 0–1, a mapping without a reason, a contradiction without both sides.

## The page: `srs.src.html`

`<html data-register="paper" data-srs="srs.json">`, the kit link, and figures as on any page. Paper suits a document review; Instrument suits a coverage audit. The SRS tags:

| Tag | Draws |
|---|---|
| `<ve-coverage>` | KPI strip: UI requirements on a screen (waffle), contradictions, gaps, open questions |
| `<ve-modules>` | one card per module: requirement status dots and its screens |
| `<ve-trace [module=] [kind=]>` | requirement → screens table with a status chip per row; `kind`: `functional nonfunctional business_rule user_story use_case security` |
| `<ve-gaps [only=findings\|computed]>` | small multiples: each finding and each computed gap, with the screen and the control outlined |
| `<ve-screen id= [variant=] [hl=] [legend=false]>` | one screenshot with its numbered controls and where each leads |
| `<ve-journey id=>` | inside `<figure class="ve-steps">`: path strip, the screen of each step with the control outlined, and the player |
| `<ve-proto [start=]>` | the clickable prototype: Back, the path, a chooser for several outcomes, dashed controls that lead nowhere |
| `<ve-req id=>` | an inline ID; hovering it lights its rows and screens |

Requirements light as `data-ref="r-<ID>"` and screens as `data-ref="s-<id>"`, so a hand-drawn `<ve-flow>` node can join the linked highlighting.

Typical page; merge, reorder, or drop:

| Section | Figure |
|---|---|
| Header | h1 is the verdict with its number: "15 of 16 screen requirements are on a screen"; the lead names the two biggest problems |
| System | `<ve-flow>`: the system in the middle, one actor above and one to its left, services to its right and below, so every arrow is straight; every arrow a verb from the SRS |
| Coverage | `<ve-coverage>` and one sentence on what has no UI and how to test it |
| Modules | `<ve-modules>`; the heading names the module that needs work |
| Journeys | one `<ve-journey>` figure per journey worth seeing, happy path first |
| Rules and limits | business rules as small decision tables or small multiples; NFRs as a KPI strip with their targets |
| Gaps | `<ve-gaps>`, then a `<ve-ask>` for each decision only the reader can make: which side of a contradiction wins, whether a missing screen is designed or deferred |
| Trace | `<ve-trace>` |
| Prototype | `<ve-proto>` in a figure |

The render prints an `SRS:` line (requirements, coverage, screens, journeys, findings, gaps, image size). Report it, the low-confidence links, and every finding when you hand over.
