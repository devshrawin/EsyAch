#!/usr/bin/env python3
"""Validate a flowmap graph (architecture.json or screens.json). Python stdlib only.

Usage: validate.py <graph.json> [--root SRC_DIR] [--strict]

Checks: schema shape and enums, unique ids, every reference resolves (edge endpoints,
hub attachments, ports, groups, layers), every flow step maps to a real edge that leaves
an already-visited node, no orphan nodes, and (with --root) every file:line of evidence
exists in the analysed source. Exit code 1 on any error; warnings never fail unless --strict.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

NODE_KINDS = {"entrypoint", "trigger", "hub", "service", "module", "datastore", "external", "queue", "ui",
              "job", "config", "util", "merge", "screen"}
EDGE_KINDS = {"main", "dependency"}
MECHANISMS = {"call", "http", "event", "sql", "file", "queue", "cache", "navigate", "other"}
CONFIDENCE = {"high", "med", "low"}
STATUS = {"active", "deactivated"}
SYNC = {"sync", "async"}
FLOW_KINDS = {"happy", "alternate", "failure", "side_effect", "scheduled"}
START_KINDS = {"entrypoint", "trigger", "ui", "screen"}


class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)


def _req(obj, keys, where, r: Report):
    for k in keys:
        if k not in obj or obj[k] in (None, ""):
            r.err(f"{where}: missing required field '{k}'")


def _enum(value, allowed, where, r: Report):
    if value is not None and value not in allowed:
        r.err(f"{where}: '{value}' not in {sorted(allowed)}")


class EvidenceChecker:
    def __init__(self, root: Path | None):
        self.root = root.resolve() if root else None
        self._lines: dict[str, int | None] = {}
        self.user_only: set[str] = set()  # items carrying reviewer ("user") evidence

    def line_count(self, rel):
        if rel not in self._lines:
            p = (self.root / rel).resolve()
            if self.root not in p.parents and p != self.root or not p.is_file():
                self._lines[rel] = None
            else:
                self._lines[rel] = p.read_text(encoding="utf-8", errors="replace").count("\n") + 1
        return self._lines[rel]

    def check(self, ev, where, r: Report):
        if not isinstance(ev, dict):
            r.err(f"{where}: evidence must be an object")
            return
        if "file" in ev:
            line = ev.get("line")
            if not isinstance(line, int) or line < 1:
                r.err(f"{where}: evidence {ev.get('file')} needs a positive integer line")
            if self.root is not None:
                n = self.line_count(ev["file"])
                if n is None:
                    r.err(f"{where}: evidence file not found: {ev['file']}")
                elif isinstance(line, int) and line > n:
                    r.err(f"{where}: evidence {ev['file']}:{line} beyond end of file ({n} lines)")
        elif ev.get("user"):
            self.user_only.add(where.split(" step")[0])
        elif not ({"req", "screen", "section"} & ev.keys()):
            r.err(f"{where}: evidence needs file+line, req, screen, section or user")


def validate(g: dict, root: Path | None = None, screens_dir: Path | None = None, spec: dict | None = None) -> Report:
    r = Report()
    ev = EvidenceChecker(root)
    if g.get("schema") != "flowmap/1":
        r.err("top-level: schema must be 'flowmap/1'")
    _enum(g.get("mode"), {"code", "spec"}, "top-level mode", r)
    _req(g.get("project", {}), ["name"], "project", r)
    for key in ("nodes", "edges", "flows"):
        if not isinstance(g.get(key), list):
            r.err(f"top-level: '{key}' must be a list")
            return r

    layers = {l["id"] for l in g.get("layers", []) if "id" in l}
    groups = {gr["id"] for gr in g.get("groups", []) if "id" in gr}
    for gr in g.get("groups", []):
        if gr.get("parent") and gr["parent"] not in groups:
            r.err(f"group {gr.get('id')}: unknown parent group '{gr['parent']}'")

    nodes: dict[str, dict] = {}
    for i, n in enumerate(g["nodes"]):
        where = f"node[{i}] {n.get('id', '?')}"
        _req(n, ["id", "label", "kind"], where, r)
        if n.get("id") in nodes:
            r.err(f"{where}: duplicate id")
        nodes[n.get("id")] = n
        _enum(n.get("kind"), NODE_KINDS, where + " kind", r)
        _enum(n.get("status", "active"), STATUS, where + " status", r)
        _enum(n.get("confidence", "high"), CONFIDENCE, where + " confidence", r)
        if n.get("layer") and layers and n["layer"] not in layers:
            r.err(f"{where}: unknown layer '{n['layer']}'")
        if n.get("group") and n["group"] not in groups:
            r.err(f"{where}: unknown group '{n['group']}'")
        if not n.get("evidence"):
            (r.err if n.get("confidence", "high") != "low" else r.warn)(f"{where}: no evidence (mark confidence low if inferred)")
        for e in n.get("evidence", []):
            ev.check(e, where, r)
        if n.get("kind") == "hub" and not isinstance(n.get("ports", []), list):
            r.err(f"{where}: ports must be a list")

    for nid, n in nodes.items():
        if n.get("hub"):
            hub = nodes.get(n["hub"])
            if hub is None:
                r.err(f"node {nid}: attached to unknown hub '{n['hub']}'")
            elif hub.get("kind") != "hub":
                r.err(f"node {nid}: attached to '{n['hub']}' which is not a hub")
            elif n.get("port") and n["port"] not in hub.get("ports", []):
                r.err(f"node {nid}: port '{n['port']}' not declared on hub '{n['hub']}'")

    edges: dict[str, dict] = {}
    degree = {nid: 0 for nid in nodes}
    for i, e in enumerate(g["edges"]):
        where = f"edge[{i}] {e.get('id', '?')}"
        _req(e, ["id", "from", "to", "kind", "mechanism"], where, r)
        if e.get("id") in edges:
            r.err(f"{where}: duplicate id")
        edges[e.get("id")] = e
        for end in ("from", "to"):
            if e.get(end) not in nodes:
                r.err(f"{where}: '{end}' references unknown node '{e.get(end)}'")
            else:
                degree[e[end]] += 1
        if e.get("from") == e.get("to") and not (g.get("mode") == "spec" and e.get("mechanism") == "navigate"):
            r.err(f"{where}: self-loop (only Mode B navigate edges may return to the same screen)")
        _enum(e.get("kind"), EDGE_KINDS, where + " kind", r)
        _enum(e.get("mechanism"), MECHANISMS, where + " mechanism", r)
        _enum(e.get("sync", "sync"), SYNC, where + " sync", r)
        _enum(e.get("confidence", "high"), CONFIDENCE, where + " confidence", r)
        if e.get("port"):
            src = nodes.get(e.get("from"), {})
            if e["port"] not in src.get("ports", []):
                r.err(f"{where}: port '{e['port']}' not declared on source '{e.get('from')}'")
        if e.get("inferred"):
            if e.get("confidence", "high") == "high":
                r.err(f"{where}: inferred edges cannot be high confidence")
            if not e.get("reason"):
                r.err(f"{where}: inferred edges need a 'reason'")
        if not e.get("evidence") and not e.get("inferred"):
            r.err(f"{where}: no evidence (set inferred=true with a reason if it is inferred)")
        for x in e.get("evidence", []):
            ev.check(x, where, r)

    for nid, d in degree.items():
        if d == 0:
            r.err(f"node {nid}: orphan (no edges)")

    flow_ids = set()
    for i, f in enumerate(g["flows"]):
        where = f"flow[{i}] {f.get('id', '?')}"
        _req(f, ["id", "name", "trigger", "steps"], where, r)
        if f.get("id") in flow_ids:
            r.err(f"{where}: duplicate id")
        flow_ids.add(f.get("id"))
        _enum(f.get("kind", "happy"), FLOW_KINDS, where + " kind", r)
        trig = nodes.get(f.get("trigger"))
        if trig is None:
            r.err(f"{where}: unknown trigger node '{f.get('trigger')}'")
            continue
        if trig.get("kind") not in START_KINDS:
            r.err(f"{where}: trigger '{f['trigger']}' is a {trig.get('kind')}, expected one of {sorted(START_KINDS)}")
        steps = f.get("steps") or []
        if not steps:
            r.err(f"{where}: no steps")
            continue
        if steps[0].get("node") != f["trigger"]:
            r.err(f"{where}: first step must be the trigger node")
        visited = set()
        for j, s in enumerate(steps):
            sw = f"{where} step {j + 1}"
            if s.get("node") not in nodes:
                r.err(f"{sw}: unknown node '{s.get('node')}'")
                continue
            if not s.get("description"):
                r.err(f"{sw}: missing description")
            if j > 0 and s.get("action") and not s.get("edge"):
                # in-place action on the same screen (Mode B): open a menu, press Refund, ...
                if s["node"] != steps[j - 1].get("node"):
                    r.err(f"{sw}: an action step without an edge must stay on the previous step's node")
            elif j > 0:
                e = edges.get(s.get("edge"))
                if e is None:
                    r.err(f"{sw}: edge '{s.get('edge')}' does not exist")
                elif e["to"] != s["node"]:
                    r.err(f"{sw}: edge {e['id']} goes to '{e['to']}', not '{s['node']}'")
                elif e["from"] not in visited:
                    r.err(f"{sw}: edge {e['id']} starts at '{e['from']}', which this flow has not reached yet")
            if s.get("evidence"):
                ev.check(s["evidence"], sw, r)
            elif g.get("mode") == "code":
                r.warn(f"{sw}: no file:line evidence")
            visited.add(s["node"])

    if g.get("mode") == "spec":
        validate_spec(g, nodes, edges, r, screens_dir, spec)

    for n in g["nodes"]:
        if "pos" in n and not (isinstance(n["pos"], dict) and all(isinstance(n["pos"].get(k), (int, float)) for k in "xy")):
            r.err(f"node {n.get('id')}: pos must be {{x, y}} numbers")
    for where in sorted(ev.user_only):
        r.warn(f"{where}: has reviewer-provided evidence (from the editor), not file:line")

    # coverage: every entry point / trigger should start (or appear in) some flow
    in_flows = {s.get("node") for f in g["flows"] for s in f.get("steps", [])}
    for nid, n in nodes.items():
        if n.get("kind") in ("entrypoint", "trigger") and n.get("status", "active") == "active" and nid not in in_flows:
            r.warn(f"node {nid}: entry point not covered by any flow")
    return r


HOTSPOT_KINDS = {"button", "link", "tab", "menu", "field", "toggle", "checkbox", "image", "other"}
STATES = {"default", "empty", "filled", "error", "success", "modal", "loading"}
FINDING_TYPES = {"contradiction", "missing_state", "gap", "ambiguity", "note"}


def _box_ok(b):
    return (isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)
            and all(0 <= v <= 1 for v in b) and b[2] > 0 and b[3] > 0 and b[0] + b[2] <= 1.001 and b[1] + b[3] <= 1.001)


def validate_spec(g, nodes, edges, r: Report, screens_dir: Path | None, spec: dict | None):
    """Mode B rules: images exist, hotspot boxes inside 0-1, links and requirement IDs resolve."""
    reqs = {x.get("id"): x for x in g.get("requirements", [])}
    if not reqs:
        r.err("spec mode: top-level 'requirements' is empty")
    for i, x in enumerate(g.get("requirements", [])):
        _req(x, ["id", "text"], f"requirement[{i}]", r)
    if spec is not None:
        known = {x["id"] for x in spec.get("requirements", [])}
        for rid in reqs:
            if rid not in known:
                r.err(f"requirement {rid}: not in the SRS extraction (spec.json)")
    actors = {a.get("id") for a in g.get("actors", [])}

    def req_ref(rid, where):
        if rid not in reqs:
            r.err(f"{where}: unknown requirement '{rid}'")

    def image_ok(name, where):
        if not name:
            r.err(f"{where}: missing image")
        elif screens_dir is not None and not (screens_dir / name).is_file():
            r.err(f"{where}: image not found: {screens_dir / name}")

    for nid, n in nodes.items():
        if n.get("kind") != "screen":
            continue
        where = f"screen {nid}"
        image_ok(n.get("image"), where)
        _enum(n.get("state", "default"), STATES, where + " state", r)
        for a in n.get("actors", []):
            if actors and a not in actors:
                r.err(f"{where}: unknown actor '{a}'")
        for m in n.get("requirements", []):
            req_ref(m.get("id"), where)
            _enum(m.get("confidence"), CONFIDENCE, f"{where} requirement {m.get('id')} confidence", r)
            if not m.get("reason"):
                r.err(f"{where}: requirement {m.get('id')} needs a 'reason' (why this screen satisfies it)")
        hs_sets = [("", n.get("hotspots", []))] + [(f" variant {v.get('id')}", v.get("hotspots", [])) for v in n.get("variants", [])]
        for v in n.get("variants", []):
            image_ok(v.get("image"), f"{where} variant {v.get('id')}")
            _enum(v.get("state", "default"), STATES, f"{where} variant state", r)
        for suffix, hss in hs_sets:
            seen = set()
            for h in hss:
                hw = f"{where}{suffix} hotspot {h.get('id')}"
                if h.get("id") in seen:
                    r.err(f"{hw}: duplicate hotspot id")
                seen.add(h.get("id"))
                _enum(h.get("kind"), HOTSPOT_KINDS, hw + " kind", r)
                if not _box_ok(h.get("box")):
                    r.err(f"{hw}: box must be [x, y, w, h] in 0-1 and inside the image, got {h.get('box')}")
    for eid, e in edges.items():
        src = nodes.get(e.get("from"), {})
        for rid in e.get("reqs", []):
            req_ref(rid, f"edge {eid}")
        if src.get("kind") == "screen" and e.get("mechanism") == "navigate":
            if e.get("hotspot") and e["hotspot"] not in {h.get("id") for h in src.get("hotspots", [])}:
                r.err(f"edge {eid}: hotspot '{e['hotspot']}' does not exist on screen {src.get('id')}")
            if e.get("to_variant") and e["to_variant"] not in {v.get("id") for v in nodes.get(e.get("to"), {}).get("variants", [])}:
                r.err(f"edge {eid}: to_variant '{e['to_variant']}' does not exist on {e.get('to')}")
    for f in g.get("flows", []):
        for j, s in enumerate(f.get("steps", [])):
            sw = f"flow {f.get('id')} step {j + 1}"
            ev = s.get("evidence") or {}
            if ev.get("req"):
                req_ref(ev["req"], sw)
            n = nodes.get(s.get("node"), {})
            if s.get("variant") and s["variant"] not in {v.get("id") for v in n.get("variants", [])}:
                r.err(f"{sw}: variant '{s['variant']}' does not exist on {s.get('node')}")
            if s.get("hotspot") and s["hotspot"] not in {h.get("id") for h in n.get("hotspots", [])}:
                r.err(f"{sw}: hotspot '{s['hotspot']}' does not exist on {s.get('node')}")
        if f.get("actor") and actors and f["actor"].lower() not in actors and f["actor"] not in {a.get("label") for a in g.get("actors", [])}:
            r.warn(f"flow {f.get('id')}: actor '{f['actor']}' is not in actors")
    for k, fd in enumerate(g.get("findings", [])):
        fw = f"finding {fd.get('id', k)}"
        _req(fd, ["id", "type", "text"], fw, r)
        _enum(fd.get("type"), FINDING_TYPES, fw + " type", r)
        _enum(fd.get("severity", "med"), CONFIDENCE, fw + " severity", r)
        if fd.get("req"):
            req_ref(fd["req"], fw)
        if fd.get("screen") and fd["screen"] not in nodes:
            r.err(f"{fw}: unknown screen '{fd['screen']}'")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("graph", type=Path)
    ap.add_argument("--root", type=Path, help="source root for file:line evidence checks")
    ap.add_argument("--strict", action="store_true", help="treat warnings as errors")
    ap.add_argument("--screens", type=Path, help="Mode B: screenshot folder (default: project.screens_dir next to the JSON)")
    ap.add_argument("--spec", type=Path, help="Mode B: spec.json / spec_text.json to check requirement IDs against")
    args = ap.parse_args()
    try:
        g = json.loads(args.graph.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"ERROR cannot read {args.graph}: {exc}")
        sys.exit(1)
    screens = args.screens
    if screens is None and g.get("mode") == "spec" and g.get("project", {}).get("screens_dir"):
        screens = (args.graph.parent / g["project"]["screens_dir"]).resolve()
    spec = json.loads(args.spec.read_text(encoding="utf-8")) if args.spec else None
    rep = validate(g, args.root, screens, spec)
    for w in rep.warnings:
        print(f"WARN  {w}")
    for e in rep.errors:
        print(f"ERROR {e}")
    failed = bool(rep.errors) or (args.strict and rep.warnings)
    n, e, f = len(g.get("nodes", [])), len(g.get("edges", [])), len(g.get("flows", []))
    print(f"{'FAIL' if failed else 'OK'}: {n} nodes, {e} edges, {f} flows, {len(rep.errors)} errors, {len(rep.warnings)} warnings")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
