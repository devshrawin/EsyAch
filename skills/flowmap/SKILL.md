---
name: flowmap
description: Build an interactive, offline, n8n-style flow map. Mode A maps a codebase (local path, git URL or zip) into architecture plus named, replayable data-flow paths. Mode B maps an SRS plus screenshots into a clickable user-journey prototype with a coverage/gap report. Use when the user asks to visualise architecture, data flows, request paths, user flows or journeys, or to check an SRS against screens.
---

# flowmap

The output is one self-contained HTML file (no network) built from a JSON graph in the `flowmap/1`
schema (`docs/schema.md`). Scripts gather facts deterministically. **You** do the analysis and write
the graph. Then `validate.py` checks it and `build.py` renders it.

## Ground rules (both modes)

- **Never invent** components, transitions, requirements or screens. Every node and edge carries
  evidence (`file:line`, or a requirement ID/section in Mode B).
- Anything inferred gets `confidence: "low"` or `"med"`. For edges also set `inferred: true` and a
  `reason`. A summary states facts; mark guesses as guesses.
- Never execute, install or import code from the target. Never send code, SRS text or screenshots to
  any external service.
- Ids are short and stable: `ep_checkout`, `hub_orders`, `ds_postgres`, `e_orders_pg`.

## Mode A: code → architecture.json

Start from `inventory.json` (entry points, call graph, imports, datastores, queues, caches, env vars,
external SDKs and URLs, dead code, feature-flag defaults). Then read the code it points to.

**Choose nodes at the level a new engineer needs.** Usually that means one node per entry point, per
domain service/module, per datastore, queue, cache and external API, and per worker/job. Fold small
helpers into their caller and list them in `symbols`.

| what you found | kind | rendering |
|---|---|---|
| HTTP route, CLI command, page the user starts from | `entrypoint` (or `ui` for the frontend) | red bolt |
| webhook, cron, queue consumer, event listener | `trigger` | red bolt |
| a service that talks to several backing resources | `hub` with `ports` | wide card with ports |
| DB / cache / queue / SDK owned by one hub | `datastore` `queue` `external` with `hub` + `port` | circle under the hub, dashed |
| standalone service / module / job | `service` `module` `job` | square |
| fan-in point (results merged) | `merge` | small square |

- Shared resources: attach the circle to the hub that owns it most. Other users point at it with
  `dependency` edges.
- Feature-flagged-off code, routes inside `if FLAG:` whose default is off, and code reachable only
  from those → `status: "deactivated"`, with the flag default as evidence. Commented-out routes go in
  the report, not on the canvas.
- Edges: `main` for the request/data path (call, HTTP, queue consume, cron fire), `dependency` for
  "uses" relations (hub port → DB/SDK). On main edges, `label` is the short verb shown at the source
  port ("POST", "BRPOP", "02:00"). `payload` is the data shape.

**Flows are the point.** Write a named flow for **every** entry point and trigger, plus:
- failure paths (declined card → 402, duplicate e-mail → 409, 404s) as `kind: "failure"`
- async side effects (enqueue → worker → e-mail) inside the flow that causes them
- scheduled jobs as `kind: "scheduled"`

Each step names the node, the edge used to reach it (the edge must start at a node the flow has
already visited), a one-line description, the payload where useful, and `file:line` evidence.

## Reviewer edits are authoritative

People correct maps in the viewer (Edit mode). Saved JSON carries `edited: true`, `confirmed: true`,
manual `pos`, and reviewer evidence `{"user": true, "note": …}`. When re-analysing a target whose
`.flowmap/architecture.json` already exists:
- keep every `confirmed` node or edge as it is, and every manual `pos`;
- keep `edited` items unless the code now contradicts them. If it does, keep the edit and tell the
  user what changed;
- never silently delete a reviewer-added node, edge or flow.
To only re-render after edits, use `/flowmap-update`, not a new analysis.

## Mode B: SRS + screenshots → screens.json

**SRS.** `spec_extract.py` gives headings, tables and requirement IDs (FR-, NFR-, REQ-, BR-, US-, UC-,
SR-) with priority, section and a `ui` flag (false when the text says there is no user interface). In
`spec.json` record actors/roles, modules (with their requirement IDs), user stories, requirements,
business rules, validations, notifications, integrations and non-functional notes. Copy IDs and text
exactly. Never write a requirement the SRS does not contain.

**Screenshots.** View every image in `grid/` (the 10 % grid lets you read coordinates). For each screen
record `id`, `label` (title), `purpose`, `actors`, `state` (`default empty filled error success modal
loading`), `image`, `image_size`, `entry` (where users start), and **every** visible interactive
element as a hotspot `{id, label, kind, box: [x, y, w, h]}` with 0-1 coordinates measured on the image.
`kind` is one of `button link tab menu field toggle checkbox image other`. Set `in_place: true` (with a
`note`) for controls that act without leaving the screen. Use filenames and numbering as hints, but
trust what you see. Near-duplicates from `screens_manifest.json` (same screen, other state) become one
screen with `variants: [{id, label, image, state, hotspots}]`. Warn the user about anything that looks
like real personal data.

**Mapping.** On each screen, `requirements: [{id, confidence, reason}]`. The reason cites what is
visible (field names, button text, headings). Transitions are `kind: "main"`, `mechanism: "navigate"`
edges with `hotspot` (the control on the source screen), `label` ("Click Place order"), an optional
`condition` ("role = Admin", "card declined"), `reqs` and evidence (`{req}` / `{screen}`).
- A transition shown by the screenshots or stated in the SRS is a normal edge.
- A transition **neither shows** gets `inferred: true`, `confidence: "low"` or `"med"`, and a
  `reason`. It is drawn dashed with a "?".
- A transition to another state of the same screen is a self-loop with `to_variant`.
- Header links and sign-out on every screen get `global: true`; they are hidden on the canvas unless a
  journey uses them.
- A control whose destination is unknown keeps no edge. The Coverage panel lists it.

**Journeys** (`flows`) per actor: happy paths, alternate paths and error paths from the SRS. Each step
gives `node`, `edge` (except the first), `description`, the `hotspot` used to leave that screen,
`variant` when a step shows another state, and `evidence: {req}`. An in-place action is a step with
`action: true`, no edge, on the same screen.

**Findings** (`findings`): `contradiction` (the SRS says X, the screen shows Y; fill `srs_says` and
`screen_shows`), `missing_state` (the SRS describes a state no screenshot shows), `ambiguity`, `note`.
Each has `severity` and evidence. Structural gaps are computed by `gaps.py` and the viewer, not written
by hand: requirements with no screen, screens with no requirement, dead ends, unreachable screens,
controls that lead nowhere.

## Finish

Run `validate.py` (with `--root` in Mode A) until it prints `OK`, then `build.py`. Report the HTML
path, the flows, deactivated/dead code, and every low-confidence item so the user can verify it.
