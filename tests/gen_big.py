#!/usr/bin/env python3
"""Generate a synthetic flowmap graph for performance checks (no groups: the viewer auto-groups by folder).

Usage: gen_big.py [N_NODES] -o big.json
"""
import argparse
import json
import random


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("n", type=int, nargs="?", default=600)
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()
    rnd = random.Random(7)
    folders = [f"pkg{i:02d}" for i in range(12)]
    nodes, edges = [], []
    ev = lambda f: [{"file": f, "line": 1}]
    for i in range(a.n):
        folder = folders[i % len(folders)]
        f = f"{folder}/mod{i}.py"
        if i < 12:
            nodes.append({"id": f"ep{i}", "label": f"Route {i}", "subtitle": f"GET /api/r{i}", "kind": "entrypoint", "files": [f], "evidence": ev(f)})
        elif i % 25 == 0:
            nodes.append({"id": f"h{i}", "label": f"Hub {i}", "subtitle": f, "kind": "hub", "ports": ["DB", "API"], "files": [f], "evidence": ev(f)})
        else:
            nodes.append({"id": f"n{i}", "label": f"Module {i}", "subtitle": f, "kind": rnd.choice(["service", "module", "util"]), "files": [f], "evidence": ev(f)})
    hubs = [n for n in nodes if n["kind"] == "hub"]
    for h in hubs:
        for port, kind in (("DB", "datastore"), ("API", "external")):
            sid = f"{h['id']}_{port.lower()}"
            nodes.append({"id": sid, "label": f"{port} client", "kind": kind, "hub": h["id"], "port": port, "files": h["files"], "evidence": h["evidence"]})
            edges.append({"id": f"d_{sid}", "from": h["id"], "to": sid, "kind": "dependency", "port": port, "mechanism": "sql" if port == "DB" else "http", "evidence": h["evidence"]})
    main = [n for n in nodes if not n.get("hub")]
    for idx, n in enumerate(main[12:], start=12):
        src = main[rnd.randrange(0, idx)]
        edges.append({"id": f"e{len(edges)}", "from": src["id"], "to": n["id"], "kind": "main", "mechanism": "call", "label": "call()", "evidence": src["evidence"]})
    has_out = {e["from"] for e in edges}
    for k in range(12):
        if f"ep{k}" not in has_out:
            dst = main[rnd.randrange(12, len(main))]
            edges.append({"id": f"e{len(edges)}", "from": f"ep{k}", "to": dst["id"], "kind": "main", "mechanism": "call", "label": "call()", "evidence": main[k]["evidence"]})
    out_edges = {}
    for e in edges:
        if e["kind"] == "main":
            out_edges.setdefault(e["from"], []).append(e)
    flows = []
    for k in range(6):
        cur, steps = f"ep{k}", [{"node": f"ep{k}", "description": "start"}]
        for _ in range(8):
            nxt = out_edges.get(cur)
            if not nxt:
                break
            e = rnd.choice(nxt)
            steps.append({"node": e["to"], "edge": e["id"], "description": f"{e['from']} calls {e['to']}"})
            cur = e["to"]
        flows.append({"id": f"f{k}", "name": f"Synthetic flow {k}", "trigger": f"ep{k}", "steps": steps})
    g = {"schema": "flowmap/1", "mode": "code", "project": {"name": f"synthetic-{a.n}"}, "nodes": nodes, "edges": edges, "flows": flows}
    json.dump(g, open(a.out, "w"))
    print(f"{len(nodes)} nodes, {len(edges)} edges, {len(flows)} flows -> {a.out}")


if __name__ == "__main__":
    main()
