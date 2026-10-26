# flowmap graph schema (`flowmap/1`)

One schema for both modes. Mode A writes `.flowmap/architecture.json` (`"mode": "code"`), Mode B writes
`.flowmap/screens.json` (`"mode": "spec"`). `scripts/validate.py` is the source of truth for these rules.

```jsonc
{
  "schema": "flowmap/1",
  "mode": "code",                       // "code" (Mode A) | "spec" (Mode B)
  "project": { "name": "shop-demo", "source": "…", "summary": "…", "generated_at": "ISO-8601" },
  "layers": [{ "id": "api", "label": "HTTP API" }],          // optional, ordered
  "groups": [{ "id": "api", "label": "api/", "parent": null }], // optional, nestable
  "nodes": [ /* Node */ ],
  "edges": [ /* Edge */ ],
  "flows": [ /* Flow */ ]
}
```

## Node

| field | req | notes |
|---|---|---|
| `id` | ✓ | unique |
| `label` | ✓ | shown under the node (inside it for hubs) |
| `subtitle` | | small grey line, e.g. `POST /api/users` |
| `kind` | ✓ | `entrypoint` `trigger` `hub` `service` `module` `datastore` `external` `queue` `ui` `job` `config` `util` `merge` `screen` |
| `tech` | | picks the icon/colour: `python` `react` `http` `postgres` `redis` `stripe` `smtp` `cron` `file` … |
| `layer`, `group` | | must reference `layers` / `groups` |
| `hub` + `port` | | draw this node as a **circle under that hub**, attached to the named port with a dashed line |
| `ports` | hubs | port names on the hub's bottom edge, e.g. `["DB", "Payments", "Queue"]` |
| `files`, `symbols` | | key files / functions / classes |
| `summary` | | one or two sentences, facts only |
| `status` | | `active` (default) or `deactivated` (dimmed, label gets "(Deactivated)") |
| `confidence` | | `high` (default) `med` `low` |
| `evidence` | ✓¹ | `[{file, line, note?}]` (Mode B also `{req}`, `{screen}`, `{section}`) |
| `pos` | | `{x, y}` manual position saved by the editor (wins over auto layout) |
| `edited`, `confirmed` | | set by the editor: changed by a person / checked by a person |

¹ Required unless `confidence` is `low`. Evidence written in the editor is `{"user": true, "note": "…"}`
(accepted, reported as a warning so it is visible).

Rendering: `entrypoint`/`trigger` get the red bolt and rounded-left shape; `hub` is the wide card with
ports; nodes with `hub` set are circles; `merge` is a small square; everything else is the 64 px square.
A node with no outgoing main edge shows the n8n "+" stub.

## Edge

| field | req | notes |
|---|---|---|
| `id`, `from`, `to` | ✓ | node ids |
| `kind` | ✓ | `main` (solid, arrow) or `dependency` (dashed) |
| `mechanism` | ✓ | `call` `http` `event` `sql` `file` `queue` `cache` `navigate` `other` |
| `sync` | | `sync` (default) / `async` |
| `port` | | hub port the edge leaves from (dependency edges from hubs) |
| `label` | | main edges: shown next to the source port (HTTP verb, event, button). dependency edges: in the pill |
| `payload` | | main edges: shown in the mid-edge pill; always in the hover card |
| `condition` | | shown as `if …` in the pill instead of the payload |
| `inferred` + `reason` | | dashed with a `?` badge; must not be `high` confidence and must say why |
| `confidence`, `evidence` | ✓² | as for nodes |

² `evidence` is required unless `inferred` is true. Edges also take `edited` / `confirmed`.

## Flow

```jsonc
{
  "id": "checkout", "name": "Checkout & pay",
  "kind": "happy",             // happy | alternate | failure | side_effect | scheduled
  "actor": "Shopper", "description": "…",
  "trigger": "ui_storefront",  // entrypoint | trigger | ui | screen node; also step 1
  "steps": [
    { "node": "ui_storefront", "description": "…", "evidence": {"file": "…", "line": 9} },
    { "node": "ep_checkout", "edge": "e_ui_checkout", "description": "…", "payload": "{…}", "evidence": {…} }
  ]
}
```

Rule for steps after the first: `edge.to == step.node` and `edge.from` is a node the flow has
already visited. Fan-out from a hub is fine (hub → DB, then hub → Stripe), and a node may repeat.

## Groups and big graphs

`groups` (with `node.group`) can be collapsed into one stacked card in the viewer. Graphs with more than
60 nodes and no `groups` are grouped automatically by top-level folder (`files[0]`). Graphs with more
than 150 nodes open with all groups collapsed. Circles always travel with their hub.
