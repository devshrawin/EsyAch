"""Mode B coverage / gap analysis over a screens.json graph. Python stdlib only.

The viewer computes the same report live (viewer/src/coverage.ts) so edits update it at once.
"""
from __future__ import annotations

from collections import deque


def coverage(g: dict) -> dict:
    screens = {n["id"]: n for n in g.get("nodes", []) if n.get("kind") == "screen"}
    reqs = {r["id"]: r for r in g.get("requirements", [])}
    nav = [e for e in g.get("edges", []) if e.get("from") in screens and e.get("to") in screens]

    covered = set()
    for n in screens.values():
        for r in n.get("requirements", []):
            covered.add(r["id"])
    for e in nav:
        covered.update(e.get("reqs", []))

    out_other = {s: 0 for s in screens}
    adj = {s: [] for s in screens}
    for e in nav:
        if e["from"] != e["to"]:
            out_other[e["from"]] += 1
            adj[e["from"]].append(e["to"])
    entries = [s for s, n in screens.items() if n.get("entry")]
    if not entries:
        inbound = {e["to"] for e in nav if e["from"] != e["to"]}
        entries = [s for s in screens if s not in inbound]
    seen, q = set(entries), deque(entries)
    while q:
        for t in adj[q.popleft()]:
            if t not in seen:
                seen.add(t)
                q.append(t)

    linked = {(e["from"], e.get("hotspot")) for e in nav}
    dead_hotspots = []
    for s, n in screens.items():
        for h in n.get("hotspots", []):
            if (s, h["id"]) not in linked and h.get("kind") in ("button", "link", "tab", "menu") and not h.get("in_place"):
                dead_hotspots.append({"screen": s, "hotspot": h["id"], "label": h.get("label", "")})

    return {
        "requirements_total": sum(1 for r in reqs.values() if r.get("ui", True)),
        "requirements_covered": sorted(r for r in covered if r in reqs and reqs[r].get("ui", True)),
        "requirements_without_screen": [r for r, v in reqs.items() if v.get("ui", True) and r not in covered],
        "non_ui_requirements": [r for r, v in reqs.items() if not v.get("ui", True)],
        "screens_without_requirement": [s for s, n in screens.items() if not n.get("requirements")],
        "dead_end_screens": [s for s in screens if out_other[s] == 0],
        "unreachable_screens": [s for s in screens if s not in seen],
        "hotspots_without_destination": dead_hotspots,
        "inferred_transitions": [e["id"] for e in nav if e.get("inferred")],
        "findings": g.get("findings", []),
        "entries": entries,
    }


def badges(g: dict, cov: dict | None = None) -> dict:
    """screen id -> list of (severity, text) for canvas badges."""
    cov = cov or coverage(g)
    out: dict[str, list] = {}
    add = lambda s, sev, t: out.setdefault(s, []).append((sev, t))
    for f in cov["findings"]:
        if f.get("screen"):
            add(f["screen"], "red" if f.get("severity", "high") == "high" else "amber", f.get("text", f["type"]))
    for s in cov["screens_without_requirement"]:
        add(s, "amber", "no requirement")
    for s in cov["dead_end_screens"]:
        add(s, "amber", "dead end")
    for s in cov["unreachable_screens"]:
        add(s, "red", "unreachable")
    for h in cov["hotspots_without_destination"]:
        add(h["screen"], "amber", f"'{h['label']}' leads nowhere")
    return out
