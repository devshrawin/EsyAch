#!/usr/bin/env python3
"""flowmap QA harness: runs every test case (Python + browser) and writes docs/QA.md + docs/qa-results.json.

Usage: python3 tests/qa.py [--no-browser] [--no-network]
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build as fm_build  # noqa: E402
import fm_common  # noqa: E402
import fm_spec  # noqa: E402
import ingest  # noqa: E402
import screens_prep  # noqa: E402
import spec_extract  # noqa: E402
import validate  # noqa: E402
from inventory import Inventory  # noqa: E402

SHOP = ROOT / "examples" / "shop-demo"
SPEC = ROOT / "examples" / "shop-spec"
ARCH = SHOP / ".flowmap" / "architecture.json"
SCREENS = SPEC / ".flowmap" / "screens.json"
TRUTH = SPEC / "_make" / "_truth.json"
TMP = Path(tempfile.mkdtemp(prefix="flowmap-qa-"))
PY = sys.executable

RESULTS: list[dict] = []


def case(cid, area, title, expected, steps=""):
    def deco(fn):
        fn.meta = dict(id=cid, area=area, title=title, expected=expected, steps=steps)
        CASES.append(fn)
        return fn
    return deco


CASES = []


class Skip(Exception):
    pass


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=600, **kw)


def arch():
    return json.loads(ARCH.read_text())


def spec_graph():
    return json.loads(SCREENS.read_text())


def inv(root, display=None):
    i = Inventory(Path(root).resolve(), display or str(root))
    i.run()
    return i.to_json()


def errs(g, root=None, screens=None, spec=None):
    return "\n".join(validate.validate(g, root, screens, spec).errors)


# ====================================================================== ingest & safety
@case("ING-01", "Ingest", "Local path resolves to itself", "kind=local, root = the folder", "ingest.resolve(examples/shop-demo)")
def _():
    r = ingest.resolve(str(SHOP), None)
    assert r["kind"] == "local" and Path(r["root"]) == SHOP.resolve(), r
    return f"kind={r['kind']}"


@case("ING-02", "Ingest", "Zip input: extracted, single top folder unwrapped, same inventory as the folder",
      "same entry points / calls as the local path")
def _():
    z = TMP / "shop.zip"
    with zipfile.ZipFile(z, "w") as zf:
        for p in SHOP.rglob("*"):
            if p.is_file() and ".flowmap" not in p.parts:
                zf.write(p, Path("shop-demo") / p.relative_to(SHOP))
    r = ingest.resolve(str(z), TMP / "ing02")
    a, b = inv(SHOP), inv(r["root"])
    key = lambda d: sorted((e["kind"], e.get("path") or e.get("symbol") or e.get("schedule") or "") for e in d["entrypoints"])
    assert key(a) == key(b) and len(a["calls"]) == len(b["calls"]), (len(a["calls"]), len(b["calls"]))
    return f"{len(b['entrypoints'])} entry points, {len(b['calls'])} calls (identical)"


@case("ING-03", "Ingest", "GitHub URL: shallow clone then inventory", "clone succeeds, inventory runs")
def _():
    if NO_NET:
        raise Skip("--no-network")
    r = run([PY, str(ROOT / "scripts/ingest.py"), "https://github.com/octocat/Hello-World", "--workdir", str(TMP / "ing03")])
    if r.returncode != 0:
        raise Skip(f"network unavailable: {r.stdout[-200:]}{r.stderr[-200:]}")
    root = json.loads(r.stdout)["root"]
    d = inv(root)
    assert (Path(root) / ".git").exists() and d["stats"]["files"] >= 1
    depth = run(["git", "-C", root, "rev-list", "--count", "HEAD"]).stdout.strip()
    assert depth == "1", depth
    return f"cloned, depth={depth}, {d['stats']['files']} file(s)"


@case("ING-04", "Ingest", "owner/repo shorthand expands to a GitHub https URL", "url=https://github.com/o/r.git")
def _():
    if NO_NET:
        raise Skip("--no-network")
    r = run([PY, str(ROOT / "scripts/ingest.py"), "octocat/Spoon-Knife", "--workdir", str(TMP / "ing04")])
    if r.returncode != 0:
        raise Skip("network unavailable")
    j = json.loads(r.stdout)
    assert j["url"] == "https://github.com/octocat/Spoon-Knife.git", j
    return j["url"]


def _zip_rejected(name, writer):
    z = TMP / name
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        writer(zf)
    out = TMP / (name + ".out")
    try:
        fm_common.safe_extract_zip(z, out)
    except fm_common.UnsafeArchive as exc:
        assert not (TMP / "escape.txt").exists()
        return f"rejected: {exc}"
    raise AssertionError("archive was accepted")


@case("ING-05", "Ingest", "Zip with ../ path traversal is rejected", "UnsafeArchive, nothing written outside")
def _():
    return _zip_rejected("trav.zip", lambda zf: zf.writestr("../escape.txt", "x"))


@case("ING-06", "Ingest", "Zip with an absolute path is rejected", "UnsafeArchive")
def _():
    return _zip_rejected("abs.zip", lambda zf: zf.writestr("/tmp/abs.txt", "x"))


@case("ING-07", "Ingest", "Zip bomb (high compression ratio) is rejected", "UnsafeArchive before extraction")
def _():
    return _zip_rejected("bomb.zip", lambda zf: zf.writestr("a.txt", "0" * 60_000_000))


@case("ING-08", "Ingest", "Zip containing a symlink entry is rejected", "UnsafeArchive")
def _():
    def w(zf):
        info = zipfile.ZipInfo("link")
        info.external_attr = (0o120777 << 16)
        zf.writestr(info, "/etc/passwd")
    return _zip_rejected("sym.zip", w)


@case("ING-09", "Ingest", "Non-https URLs (http://, file://) are refused", "SystemExit, no clone")
def _():
    for u in ("http://example.com/x.git", "file:///etc"):
        r = run([PY, str(ROOT / "scripts/ingest.py"), u])
        assert r.returncode != 0, u
    return "both refused"


@case("ING-10", "Ingest", "A hostile .git/config (core.fsmonitor) in the target is never executed",
      "inventory runs, the marker file is not created")
def _():
    t = TMP / "hostile"
    (t / ".git").mkdir(parents=True)
    marker = TMP / "PWNED"
    (t / ".git" / "config").write_text(f"[core]\n\tfsmonitor = touch {marker}\n")
    (t / "app.py").write_text("print('hi')\n")
    (t / "setup.py").write_text(f"open('{marker}','w')\n")
    inv(t)
    run([PY, str(ROOT / "scripts/ingest.py"), str(t)])
    assert not marker.exists()
    return "marker absent"


@case("ING-11", "Ingest", "Missing path gives a clear error", "exit != 0 with a message")
def _():
    r = run([PY, str(ROOT / "scripts/ingest.py"), "/nope/does-not-exist"])
    assert r.returncode != 0 and "not found" in (r.stderr + r.stdout)
    return (r.stderr + r.stdout).strip()[:80]


@case("ING-12", "Ingest", "Zip with too many entries is rejected", "UnsafeArchive")
def _():
    z = TMP / "many.zip"
    with zipfile.ZipFile(z, "w") as zf:
        for i in range(30):
            zf.writestr(f"f{i}.txt", "x")
    try:
        fm_common.safe_extract_zip(z, TMP / "many", max_members=10)
    except fm_common.UnsafeArchive as exc:
        return str(exc)
    raise AssertionError("accepted")


# ====================================================================== inventory
INV = {}


def shop_inv():
    if "d" not in INV:
        INV["d"] = inv(SHOP, "shop-demo")
    return INV["d"]


@case("INV-01", "Inventory", "All 7 FastAPI routes found (incl. the flag-guarded one)", "7 http/webhook entry points")
def _():
    eps = [e for e in shop_inv()["entrypoints"] if e["kind"] in ("http_route", "webhook")]
    assert len(eps) == 7, [e.get("path") for e in eps]
    return ", ".join(f"{e['method']} {e['path']}" for e in eps)


@case("INV-02", "Inventory", "Webhook route classified as webhook", "POST /api/webhooks/stripe kind=webhook")
def _():
    w = [e for e in shop_inv()["entrypoints"] if e["kind"] == "webhook"]
    assert len(w) == 1 and w[0]["path"] == "/api/webhooks/stripe"
    return w[0]["path"]


@case("INV-03", "Inventory", "Cron job read from ops/crontab", "schedule 0 2 * * * with the command")
def _():
    c = [e for e in shop_inv()["entrypoints"] if e["kind"] == "cron"]
    assert c and c[0]["schedule"] == "0 2 * * *" and "jobs.nightly" in c[0]["command"]
    return f"{c[0]['schedule']} {c[0]['command']}"


@case("INV-04", "Inventory", "Feature-flagged route marked deactivated with flag evidence", "status=deactivated, default False, config.py:11")
def _():
    r = next(e for e in shop_inv()["entrypoints"] if e.get("symbol") == "refund")
    assert r["status"] == "deactivated" and r["guard_default"] is False and r["guard_evidence"]["line"] == 11
    return f"{r['guarded_by']} default={r['guard_default']}"


@case("INV-05", "Inventory", "Commented-out route reported as dead code", "DELETE /api/orders/{order_id} @ main.py:62")
def _():
    d = [x for x in shop_inv()["dead_code"] if x["reason"] == "commented-out route"]
    assert d and d[0]["line"] == 62
    return d[0]["symbol"]


@case("INV-06", "Inventory", "Code reachable only from deactivated code is flagged", "legacy_refund flagged")
def _():
    d = [x for x in shop_inv()["dead_code"] if x["reason"] == "only called from deactivated code"]
    assert any(x["symbol"] == "legacy_refund" for x in d)
    return "legacy_refund"


@case("INV-07", "Inventory", "Python call graph resolves across modules", "checkout -> orders.create_order")
def _():
    c = shop_inv()["calls"]
    assert any(x["caller"] == "checkout" and x["callee"] == "create_order" and x["callee_file"] == "api/services/orders.py" for x in c)
    return f"{len(c)} call edges"


@case("INV-08", "Inventory", "JS/TS cross-file calls resolved", "4 page -> api.ts calls")
def _():
    js = [x for x in shop_inv()["calls"] if x.get("lang") == "js"]
    assert len(js) == 4 and all(x["callee_file"] == "web/src/api.ts" for x in js), js
    return ", ".join(f"{x['caller']}->{x['callee']}" for x in js)


@case("INV-09", "Inventory", "fetch() calls with HTTP method", "POST /users, GET /products, POST /orders, GET /orders/{id}")
def _():
    h = shop_inv()["http_clients"]
    got = sorted((x["method"], x["url"]) for x in h)
    assert ("POST", "${BASE}/orders") in got and ("GET", "${BASE}/products") in got and len(h) == 4
    return str(got)


@case("INV-10", "Inventory", "Env vars incl. required os.environ[...]", "8 vars, STRIPE_SECRET_KEY required")
def _():
    env = shop_inv()["env_vars"]
    assert len(env) == 8 and any(x.get("required") for x in env["STRIPE_SECRET_KEY"])
    return ", ".join(env)


@case("INV-11", "Inventory", "SDKs detected; SMTP send not misread as a queue", "Stripe + SMTP externals; no smtp in queues")
def _():
    d = shop_inv()
    sdks = {x.get("sdk") for x in d["externals"]}
    assert {"Stripe", "SMTP"} <= sdks and not any("smtp" in (q.get("call") or "") for q in d["queues"])
    return str(sorted(s for s in sdks if s))


@case("INV-12", "Inventory", ".gitignore, lockfiles, node_modules, binaries and >1 MB files skipped", "only a.py, keep.log, .gitignore kept")
def _():
    r = TMP / "walk"
    r.mkdir()
    (r / ".gitignore").write_text("secret/\n*.log\n!keep.log\n")
    for rel in ["a.py", "secret/b.py", "x.log", "keep.log", "package-lock.json", "node_modules/m.js", "img.png"]:
        (r / rel).parent.mkdir(parents=True, exist_ok=True)
        (r / rel).write_text("x")
    (r / "big.txt").write_text("y" * 1_100_000)
    files, skipped = fm_common.walk_repo(r)
    names = sorted(f for f, _ in files)
    assert names == [".gitignore", "a.py", "keep.log"], names
    return f"kept {names}, skipped {skipped}"


@case("INV-13", "Inventory", "Symlinks are not followed (no escape from the repo)", "a symlink to /etc is skipped")
def _():
    r = TMP / "symrepo"
    r.mkdir()
    (r / "a.py").write_text("x = 1\n")
    os.symlink("/etc", r / "etc_link")
    os.symlink("/etc/hostname", r / "host_link")
    files, skipped = fm_common.walk_repo(r)
    assert [f for f, _ in files] == ["a.py"] and skipped.get("symlink") == 2
    return f"skipped={skipped}"


@case("INV-14", "Inventory", "A file with a syntax error does not crash the inventory", "parse_error recorded, others analysed")
def _():
    r = TMP / "broken"
    r.mkdir()
    (r / "bad.py").write_text("def broken(:\n")
    (r / "ok.py").write_text("import os\nX = os.getenv('A')\n")
    d = inv(r)
    bad = next(t for t in d["tree"] if t["path"] == "bad.py")
    assert "parse_error" in bad and "A" in d["env_vars"]
    return bad["parse_error"]


@case("INV-15", "Inventory", "Express routes detected in JS", "GET /health and POST /api/items")
def _():
    r = TMP / "express"
    r.mkdir()
    (r / "server.js").write_text("const app = require('express')();\napp.get('/health', h);\nrouter.post('/api/items', create);\n// app.delete('/old', x)\n")
    d = inv(r)
    got = sorted((e["method"], e["path"]) for e in d["entrypoints"] if e["kind"] == "http_route")
    assert got == [("GET", "/health"), ("POST", "/api/items")] and any(x["reason"] == "commented-out route" for x in d["dead_code"])
    return str(got)


@case("INV-16", "Inventory", "Go and Java routes via the regex fallback", "Go HandleFunc + gin GET, Spring @PostMapping")
def _():
    r = TMP / "polyglot"
    r.mkdir()
    (r / "main.go").write_text('package main\nfunc main() {\n http.HandleFunc("/ping", ping)\n r.GET("/users", list)\n}\n')
    (r / "Api.java").write_text('class Api {\n @PostMapping("/orders")\n void create() {}\n}\n')
    d = inv(r)
    paths = sorted(e["path"] for e in d["entrypoints"] if e["kind"] == "http_route")
    assert paths == ["/orders", "/ping", "/users"], paths
    return str(paths)


@case("INV-17", "Inventory", "Files containing NUL bytes are treated as binary", "skipped as binary")
def _():
    r = TMP / "nul"
    r.mkdir()
    (r / "data.txt").write_bytes(b"abc\x00def")
    (r / "a.py").write_text("x=1\n")
    files, skipped = fm_common.walk_repo(r)
    assert [f for f, _ in files] == ["a.py"] and skipped.get("binary") == 1
    return str(skipped)


@case("INV-18", "Inventory", "NestJS decorator routes in TypeScript (audit finding A3)", "GET /users, POST /users/:id/ban")
def _():
    r = TMP / "nest"
    r.mkdir()
    (r / "users.controller.ts").write_text("@Controller('users')\nexport class UsersController {\n  @Get()\n  list() {}\n  @Post(':id/ban')\n  ban() {}\n}\n")
    got = sorted((e["method"], e["path"]) for e in inv(r)["entrypoints"] if e["kind"] == "http_route")
    assert got == [("GET", "/users"), ("POST", "/users/:id/ban")], got
    return str(got)


# ====================================================================== validation
@case("VAL-01", "Validate", "Mode A fixture validates with evidence checked against source", "OK, 0 errors, 0 warnings")
def _():
    rep = validate.validate(arch(), SHOP)
    assert not rep.errors and not rep.warnings, rep.errors + rep.warnings
    g = arch()
    return f"OK: {len(g['nodes'])} nodes, {len(g['edges'])} edges, {len(g['flows'])} flows"


@case("VAL-02", "Validate", "Mode B fixture validates (images, boxes, requirement IDs vs SRS)", "OK, 0 errors")
def _():
    spec = json.loads((SPEC / ".flowmap" / "spec_text.json").read_text())
    rep = validate.validate(spec_graph(), None, SPEC / "screens", spec)
    assert not rep.errors, rep.errors
    return f"OK, {len(rep.warnings)} warnings"


def _mut(fn, needle, mode="a"):
    g = arch() if mode == "a" else spec_graph()
    fn(g)
    e = errs(g, SHOP if mode == "a" else None, SPEC / "screens" if mode == "b" else None)
    assert needle in e, e[:300]
    return next(l for l in e.splitlines() if needle in l)


@case("VAL-03", "Validate", "Flow step using an edge that leads elsewhere is caught", "error 'goes to'")
def _():
    return _mut(lambda g: g["flows"][0]["steps"][2].update(edge="e_ui_signup"), "goes to")


@case("VAL-04", "Validate", "Evidence line beyond end of file is caught", "error 'beyond end of file'")
def _():
    return _mut(lambda g: g["nodes"][0].update(evidence=[{"file": "web/src/api.ts", "line": 9999}]), "beyond end of file")


@case("VAL-05", "Validate", "Evidence pointing at a missing file is caught", "error 'evidence file not found'")
def _():
    return _mut(lambda g: g["nodes"][0].update(evidence=[{"file": "nope.py", "line": 1}]), "evidence file not found")


@case("VAL-06", "Validate", "Inferred edge with high confidence / no reason is rejected", "two errors")
def _():
    return _mut(lambda g: g["edges"][0].update(inferred=True, confidence="high"), "cannot be high confidence")


@case("VAL-07", "Validate", "Orphan node is caught", "error 'orphan'")
def _():
    return _mut(lambda g: g["nodes"].append({"id": "lonely", "label": "x", "kind": "module", "evidence": [{"file": "api/db.py", "line": 1}]}), "orphan")


@case("VAL-08", "Validate", "Circle attached to an undeclared hub port is caught", "error 'not declared on hub'")
def _():
    return _mut(lambda g: next(n for n in g["nodes"] if n["id"] == "ds_postgres").update(port="Nope"), "not declared on hub")


@case("VAL-09", "Validate", "Hotspot box outside 0-1 is caught", "error 'box must be'")
def _():
    return _mut(lambda g: g["nodes"][0]["hotspots"][0].update(box=[0.9, 0.5, 0.3, 0.1]), "box must be", "b")


@case("VAL-10", "Validate", "Unknown requirement reference is caught", "error 'unknown requirement'")
def _():
    return _mut(lambda g: g["edges"][0]["reqs"].append("FR-999"), "unknown requirement", "b")


@case("VAL-11", "Validate", "Missing screenshot file is caught", "error 'image not found'")
def _():
    return _mut(lambda g: g["nodes"][0].update(image="missing.png"), "image not found", "b")


@case("VAL-12", "Validate", "Journey step with an unknown variant is caught", "error 'variant'")
def _():
    return _mut(lambda g: g["flows"][1]["steps"][1].update(variant="nope"), "variant 'nope' does not exist", "b")


@case("VAL-13", "Validate", "Self-loop edges are rejected in Mode A", "error 'self-loop'")
def _():
    return _mut(lambda g: g["edges"].append({"id": "loop", "from": "hub_orders", "to": "hub_orders", "kind": "main", "mechanism": "call",
                                              "evidence": [{"file": "api/db.py", "line": 1}]}), "self-loop")


@case("VAL-14", "Validate", "An action step that changes screen is rejected", "error 'must stay'")
def _():
    return _mut(lambda g: g["flows"][4]["steps"][2].update(node="s_products"), "must stay", "b")


@case("VAL-15", "Validate", "Requirement not present in the SRS extraction is caught (--spec)", "error 'not in the SRS'")
def _():
    g = spec_graph()
    g["requirements"].append({"id": "FR-77", "text": "invented"})
    spec = json.loads((SPEC / ".flowmap" / "spec_text.json").read_text())
    e = errs(g, None, SPEC / "screens", spec)
    assert "not in the SRS" in e
    return next(l for l in e.splitlines() if "FR-77" in l)


@case("VAL-16", "Validate", "Duplicate node ids are caught", "error 'duplicate id'")
def _():
    return _mut(lambda g: g["nodes"].append(dict(g["nodes"][0])), "duplicate id")


@case("VAL-17", "Validate", "Malformed JSON exits 1 with a message (no traceback)", "ERROR cannot read")
def _():
    p = TMP / "bad.json"
    p.write_text("{not json")
    r = run([PY, str(ROOT / "scripts/validate.py"), str(p)])
    assert r.returncode == 1 and "cannot read" in r.stdout and "Traceback" not in r.stderr, r.stdout + r.stderr
    return r.stdout.strip()[:80]


@case("VAL-18", "Validate", "Requirement mapping without a reason is caught", "error 'needs a reason'")
def _():
    return _mut(lambda g: g["nodes"][0]["requirements"][0].pop("reason"), "needs a 'reason'", "b")


# ====================================================================== SRS
SRS = {}


def srs(fmt):
    if fmt not in SRS:
        SRS[fmt] = spec_extract.extract(SPEC / f"srs.{fmt}")
    return SRS[fmt]


def _ids(d):
    return [(r["id"], r["priority"], r["ui"]) for r in d["requirements"]]


@case("SRS-01", "SRS", "Markdown SRS: 19 requirements with IDs, priority, section", "FR-1..FR-16, BR-1, NFR-1..2")
def _():
    d = srs("md")
    assert len(d["requirements"]) == 19 and d["requirements"][0]["priority"] == "High" and d["requirements"][0]["section"].startswith("2.")
    return ", ".join(r["id"] for r in d["requirements"])


@case("SRS-02", "SRS", "DOCX SRS gives the same IDs, priorities and UI flags as Markdown", "identical")
def _():
    assert _ids(srs("docx")) == _ids(srs("md"))
    return "19/19 identical"


@case("SRS-03", "SRS", "PDF SRS gives the same IDs, priorities and UI flags as Markdown", "identical")
def _():
    assert _ids(srs("pdf")) == _ids(srs("md"))
    return "19/19 identical"


@case("SRS-04", "SRS", "Plain-text SRS (numbered headings, no Markdown)", "19 requirements, sections detected")
def _():
    txt = re.sub(r"^#+\s*", "", (SPEC / "srs.md").read_text(), flags=re.M).replace("**", "")
    p = TMP / "srs.txt"
    p.write_text(txt)
    d = spec_extract.extract(p)
    assert _ids(d) == _ids(srs("md")) and len(d["sections"]) >= 6, len(d["sections"])
    return f"{len(d['requirements'])} reqs, {len(d['sections'])} sections"


@case("SRS-05", "SRS", "Non-UI requirements flagged", "FR-12, NFR-1, NFR-2 ui=false")
def _():
    non = [r["id"] for r in srs("md")["requirements"] if not r["ui"]]
    assert non == ["FR-12", "NFR-1", "NFR-2"], non
    return str(non)


@case("SRS-06", "SRS", "Real-looking e-mail / phone flagged; example.com ignored", "2 PII hits, masked")
def _():
    p = TMP / "pii.md"
    p.write_text("# X\n- **FR-1** (High): Contact maria.lopez@acme-corp.io or +44 7700 900123. Test jane@example.com.\n")
    d = spec_extract.extract(p)
    kinds = sorted(x["kind"] for x in d["pii"])
    assert kinds == ["email", "phone"] and all("…" in x["value"] for x in d["pii"]), d["pii"]
    return str(d["pii"])


@case("SRS-07", "SRS", "Dotted IDs like REQ-3.2 and US-4 extracted", "REQ-3.2, US-4")
def _():
    p = TMP / "dotted.md"
    p.write_text("## 3 Billing\n- REQ-3.2: Invoices are PDF.\n- US-4 (Must): As a user I pay.\n")
    ids = [r["id"] for r in spec_extract.extract(p)["requirements"]]
    assert ids == ["REQ-3.2", "US-4"], ids
    return str(ids)


@case("SRS-08", "SRS", "Unsupported SRS format refused", "SystemExit")
def _():
    p = TMP / "srs.rtf"
    p.write_text("x")
    try:
        spec_extract.extract(p)
    except SystemExit as exc:
        return str(exc)
    raise AssertionError("accepted")


# ====================================================================== screens prep
PREP = {}


def prep():
    if "m" not in PREP:
        with contextlib.redirect_stderr(io.StringIO()):
            PREP["m"] = screens_prep.prepare(SPEC / "screens", TMP / "prep")
    return PREP["m"]


@case("SCR-01", "Screens", "All 8 screenshots read with size and order", "8 images 1280x800, order 1..8")
def _():
    m = prep()
    assert m["count"] == 8 and [s["order"] for s in m["screens"]] == list(range(1, 9))
    return f"{m['count']} images"


@case("SCR-02", "Screens", "Near-duplicates: exactly the sign-in / sign-in-error pair", "only 01<->02")
def _():
    pairs = {(s["file"], tuple(s["near_duplicates"])) for s in prep()["screens"] if s["near_duplicates"]}
    assert pairs == {("01-sign-in.png", ("02-sign-in-error.png",)), ("02-sign-in-error.png", ("01-sign-in.png",))}, pairs
    return "01 <-> 02 only"


@case("SCR-03", "Screens", "Gridded copies written for vision", "8 grid PNGs")
def _():
    prep()
    g = list((TMP / "prep" / "grid").glob("*.png"))
    assert len(g) == 8
    return f"{len(g)} grid images"


@case("SCR-04", "Screens", "Zip of screenshots: images extracted, other files ignored", "8 images, readme ignored")
def _():
    z = TMP / "shots.zip"
    with zipfile.ZipFile(z, "w") as zf:
        for p in (SPEC / "screens").glob("*.png"):
            zf.write(p, f"shots/{p.name}")
        zf.writestr("shots/readme.txt", "x")
        zf.writestr("shots/run.sh", "rm -rf /")
    with contextlib.redirect_stderr(io.StringIO()):
        m = screens_prep.prepare(z, TMP / "prepzip", grid=False)
    assert m["count"] == 8 and not list((TMP / "prepzip").rglob("*.sh"))
    return f"{m['count']} images, no scripts extracted"


@case("SCR-05", "Screens", "Screenshot zip with traversal rejected", "SystemExit unsafe archive")
def _():
    z = TMP / "evilshots.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("../../x.png", "x")
    try:
        screens_prep.prepare(z, TMP / "evilprep", grid=False)
    except SystemExit as exc:
        return str(exc)
    raise AssertionError("accepted")


@case("SCR-06", "Screens", "Corrupt image reported, not a crash", "error entry for the bad file")
def _():
    d = TMP / "corrupt"
    d.mkdir()
    shutil.copy(SPEC / "screens" / "01-sign-in.png", d / "ok.png")
    (d / "bad.png").write_bytes(b"\x89PNG\r\n\x1a\nGARBAGE")
    with contextlib.redirect_stderr(io.StringIO()):
        m = screens_prep.prepare(d, TMP / "corruptprep", grid=False)
    assert m["count"] == 1 and any("error" in s for s in m["screens"])
    return "bad.png -> error, ok.png processed"


# ====================================================================== coverage
COV = {}


def cov():
    if "c" not in COV:
        COV["c"] = fm_spec.coverage(spec_graph())
    return COV["c"]


@case("COV-01", "Coverage", "Planted gap: FR-3 (password reset) has no screen", "requirements_without_screen == [FR-3]")
def _():
    assert cov()["requirements_without_screen"] == ["FR-3"], cov()["requirements_without_screen"]
    return "FR-3"


@case("COV-02", "Coverage", "Planted contradiction: FR-2 (8 vs 6 characters) reported + red badge on Sign in", "contradiction F1 on s_signin")
def _():
    c = [f for f in cov()["findings"] if f["type"] == "contradiction"]
    b = fm_spec.badges(spec_graph())
    assert len(c) == 1 and c[0]["req"] == "FR-2" and any(s == "red" for s, _ in b["s_signin"])
    return c[0]["text"]


@case("COV-03", "Coverage", "'Forgot password?' detected as a control that leads nowhere", "1 dead hotspot")
def _():
    d = cov()["hotspots_without_destination"]
    assert [x["label"] for x in d] == ["Forgot password?"], d
    return "Forgot password?"


@case("COV-04", "Coverage", "Dead-end screen detected", "s_status becomes a dead end when its exits are removed")
def _():
    g = spec_graph()
    g["edges"] = [e for e in g["edges"] if e["from"] != "s_status"]
    c = fm_spec.coverage(g)
    assert c["dead_end_screens"] == ["s_status"], c["dead_end_screens"]
    return str(c["dead_end_screens"])


@case("COV-05", "Coverage", "Unreachable screen detected", "s_admin unreachable when sign-in -> admin is removed")
def _():
    g = spec_graph()
    g["edges"] = [e for e in g["edges"] if e["id"] != "e_signin_admin"]
    c = fm_spec.coverage(g)
    assert c["unreachable_screens"] == ["s_admin"], c["unreachable_screens"]
    return str(c["unreachable_screens"])


@case("COV-06", "Coverage", "Screen with no requirement detected", "s_status flagged when its mapping is removed")
def _():
    g = spec_graph()
    next(n for n in g["nodes"] if n["id"] == "s_status")["requirements"] = []
    assert fm_spec.coverage(g)["screens_without_requirement"] == ["s_status"]
    return "s_status"


@case("COV-07", "Coverage", "Non-UI requirements excluded from the coverage denominator", "15/16 covered (FR-12, NFR-1/2 excluded)")
def _():
    c = cov()
    assert c["requirements_total"] == 16 and len(c["requirements_covered"]) == 15
    return f"{len(c['requirements_covered'])}/{c['requirements_total']}"


@case("COV-08", "Coverage", "gaps.py Markdown report lists the planted gap and contradiction", "FR-3 and FR-2 in report")
def _():
    r = run([PY, str(ROOT / "scripts/gaps.py"), str(SCREENS)])
    assert r.returncode == 0 and "**FR-3**" in r.stdout and "contradiction" in r.stdout and "FR-2" in r.stdout
    return r.stdout.splitlines()[2]


# ====================================================================== hotspot accuracy
@case("HS-01", "Hotspots", "Every hotspot matches the true element box (IoU >= 0.9)", "all hotspots, all variants")
def _():
    truth = json.loads(TRUTH.read_text())

    def iou(a, b):
        ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
        iw, ih = max(0, min(ax2, bx2) - max(a[0], b[0])), max(0, min(ay2, by2) - max(a[1], b[1]))
        inter = iw * ih
        return inter / (a[2] * a[3] + b[2] * b[3] - inter)
    n, worst = 0, 1.0
    for node in spec_graph()["nodes"]:
        for img, hss in [(node["image"], node["hotspots"])] + [(v["image"], v["hotspots"]) for v in node.get("variants", [])]:
            for h in hss:
                best = max(iou(h["box"], t["box"]) for t in truth[img])
                worst = min(worst, best)
                n += 1
    assert worst >= 0.9, worst
    return f"{n} hotspots, worst IoU {worst:.3f}"


# ====================================================================== build
@case("BLD-01", "Build", "Mode A HTML has no external script/style/image/font references", "0 http(s) src/href, no @import url(http")
def _():
    html = (SHOP / ".flowmap" / "flowmap.html").read_text()
    ext = re.findall(r"""(?:src|href)\s*=\s*["']https?://""", html) + re.findall(r"@import\s+url\(\s*['\"]?https?://", html)
    assert not ext, ext[:3]
    return f"{len(html) // 1024} KB, 0 external refs"


@case("BLD-02", "Build", "Graph text containing </script> and <!-- cannot break out of the data tag", "escaped as <\\/script> <\\!--")
def _():
    g = arch()
    g["project"]["summary"] = "x </script><script>alert(1)</script> <!-- y"
    html = fm_build.build(g, fm_build.DEFAULT_TEMPLATE)
    data = html.split('<script id="flowmap-data" type="application/json">', 1)[1].split("</script>", 1)[0]
    assert json.loads(data.replace("<\\/", "</").replace("<\\!--", "<!--"))["project"]["summary"].startswith("x </script>")
    return "data tag intact, JSON round-trips"


@case("BLD-03", "Build", "Mode B screenshots embedded as WebP, max 1200 px wide", "8 data:image/webp assets, width <= 1200")
def _():
    from PIL import Image
    import base64
    g = fm_build.embed_images(spec_graph(), SPEC / "screens")
    sizes = []
    for k, v in g["assets"].items():
        assert v.startswith("data:image/webp;base64,")
        im = Image.open(io.BytesIO(base64.b64decode(v.split(",", 1)[1])))
        sizes.append(im.width)
    assert len(sizes) == 8 and max(sizes) <= 1200
    return f"{len(sizes)} images, widths {sorted(set(sizes))}"


@case("BLD-04", "Build", "Output above the size limit prints a warning", "WARNING ... larger than")
def _():
    out = TMP / "big.html"
    r = run([PY, "-c", f"import sys; sys.path.insert(0, {str(ROOT / 'scripts')!r}); import build; build.WARN_BYTES = 1000; "
                       f"sys.argv=['build.py', {str(ARCH)!r}, '-o', {str(out)!r}]; build.main()"])
    assert "WARNING" in r.stderr, r.stderr
    return r.stderr.strip()[:90]


@case("BLD-05", "Build", "Missing screenshot -> warning, build still succeeds", "WARNING not found; HTML written")
def _():
    g = spec_graph()
    g["nodes"][0]["image"] = "gone.png"
    p = TMP / "missing" / "screens.json"
    p.parent.mkdir()
    p.write_text(json.dumps(g))
    r = run([PY, str(ROOT / "scripts/build.py"), str(p), "-o", str(TMP / "missing" / "o.html"), "--screens", str(SPEC / "screens")])
    assert r.returncode == 0 and "not found" in r.stderr
    return r.stderr.strip()[:90]


@case("BLD-06", "Build", "Template without the data placeholder is refused", "SystemExit")
def _():
    t = TMP / "tpl.html"
    t.write_text("<html></html>")
    try:
        fm_build.build(arch(), t)
    except SystemExit as exc:
        return str(exc)[:80]
    raise AssertionError("accepted")


@case("BLD-07", "Build", "Mode B images cannot be read from outside the screens folder", "../ path not embedded")
def _():
    g = spec_graph()
    g["nodes"][0]["image"] = "../srs.md"
    with contextlib.redirect_stderr(io.StringIO()):
        out = fm_build.embed_images(g, SPEC / "screens")
    assert "../srs.md" not in out["assets"]
    return "refused"


@case("BLD-08", "Build", "build.py --theme paper makes the file open in Paper", "view.theme = paper in the embedded graph")
def _():
    out = TMP / "paper.html"
    r = run([PY, str(ROOT / "scripts/build.py"), str(ARCH), "-o", str(out), "--theme", "paper"])
    data = out.read_text().split('<script id="flowmap-data" type="application/json">', 1)[1].split("</script>", 1)[0]
    g = json.loads(data.replace("<\\/", "</"))
    assert r.returncode == 0 and g["view"]["theme"] == "paper", g.get("view")
    return "paper"


# ====================================================================== packaging
@case("PKG-01", "Packaging", "plugin.json is valid with name/version/description", "flowmap 0.x")
def _():
    p = json.loads((ROOT / ".claude-plugin/plugin.json").read_text())
    assert p["name"] == "flowmap" and p["version"] and p["description"]
    return f"{p['name']} {p['version']}"


@case("PKG-02", "Packaging", "marketplace.json lists plugin 'flowmap' in marketplace 'flowmap' (install flowmap@flowmap)", "source ./")
def _():
    m = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())
    assert m["name"] == "flowmap" and m["plugins"][0]["name"] == "flowmap" and m["plugins"][0]["source"] == "./"
    return "flowmap@flowmap"


@case("PKG-03", "Packaging", "Commands and skill have frontmatter", "description in each; skill name=flowmap")
def _():
    for f in ["commands/flowmap.md", "commands/flowmap-update.md", "skills/flowmap/SKILL.md"]:
        t = (ROOT / f).read_text()
        assert t.startswith("---") and "description:" in t.split("---")[1], f
    assert "name: flowmap" in (ROOT / "skills/flowmap/SKILL.md").read_text()
    return "3/3"


@case("PKG-04", "Packaging", "Every script referenced by the commands exists", "all present")
def _():
    refs = set()
    for f in (ROOT / "commands").glob("*.md"):
        refs |= set(re.findall(r"scripts/(\w+\.py)", f.read_text()))
    missing = [r for r in refs if not (ROOT / "scripts" / r).exists()]
    assert not missing, missing
    return ", ".join(sorted(refs))


@case("PKG-05", "Packaging", "Prebuilt viewer is newer than every viewer source file", "dist mtime >= src mtimes")
def _():
    dist = (ROOT / "viewer/dist/index.html").stat().st_mtime
    stale = [p.name for p in (ROOT / "viewer/src").glob("*") if p.stat().st_mtime > dist + 1]
    assert not stale, stale
    return "up to date"


@case("PKG-06", "Packaging", "Scripts import only the stdlib (Pillow/pypdf optional, guarded)", "no other third-party imports")
def _():
    std = set(sys.stdlib_module_names) | {f.stem for f in (ROOT / "scripts").glob("*.py")}
    bad = []
    for f in (ROOT / "scripts").glob("*.py"):
        for m in re.finditer(r"^\s*(?:from|import)\s+([\w.]+)", f.read_text(), re.M):
            mod = m.group(1).split(".")[0]
            if mod not in std and mod not in ("PIL", "pypdf"):
                bad.append(f"{f.name}:{mod}")
    assert not bad, bad
    return "stdlib + optional PIL/pypdf"


@case("PKG-07", "Packaging", "README documents install, both modes, editing and exports", "all keywords present")
def _():
    t = (ROOT / "README.md").read_text()
    for k in ["/plugin marketplace add devshrawin/EsyAch", "/plugin install flowmap@flowmap", "spec", "flowmap-update", "Export"]:
        assert k in t, k
    return "ok"


# ====================================================================== driver
def run_python():
    for fn in CASES:
        m = dict(fn.meta)
        t0 = time.time()
        try:
            actual = fn()
            m.update(status="PASS", actual=str(actual)[:300])
        except Skip as s:
            m.update(status="SKIP", actual=str(s)[:300])
        except Exception as exc:  # noqa: BLE001
            tb = traceback.format_exc().strip().splitlines()
            m.update(status="FAIL", actual=f"{type(exc).__name__}: {str(exc)[:250]} ({tb[-3].strip() if len(tb) > 2 else ''})")
        m["ms"] = int((time.time() - t0) * 1000)
        RESULTS.append(m)


def run_browser():
    big = TMP / "big.json"
    run([PY, str(ROOT / "tests/gen_big.py"), "600", "-o", str(big)])
    run([PY, str(ROOT / "scripts/build.py"), str(big), "-o", str(TMP / "big.html")])
    out = TMP / "browser.json"
    r = subprocess.run(["node", str(ROOT / "tests/qa_browser.cjs"), str(SHOP / ".flowmap/flowmap.html"), str(SPEC / ".flowmap/flowmap.html"),
                        str(TMP / "big.html"), str(out), str(TMP / "browser")], capture_output=True, text=True, timeout=900)
    if not out.exists():
        RESULTS.append(dict(id="BRW-00", area="Browser", title="Browser suite ran", expected="results file", steps="",
                            status="FAIL", actual=(r.stderr or r.stdout)[-400:], ms=0))
        return
    RESULTS.extend(json.loads(out.read_text()))


def report(path_md: Path, path_json: Path, label: str):
    path_json.write_text(json.dumps(RESULTS, indent=1) + "\n")
    tot = {s: sum(1 for r in RESULTS if r["status"] == s) for s in ("PASS", "FAIL", "SKIP")}
    areas = []
    for r in RESULTS:
        if r["area"] not in areas:
            areas.append(r["area"])
    lines = [f"# flowmap QA results ({label})", "",
             f"**{len(RESULTS)} test cases: {tot['PASS']} pass, {tot['FAIL']} fail, {tot['SKIP']} skipped.**", "",
             "| Area | Pass | Fail | Skip |", "|---|---|---|---|"]
    for a in areas:
        rs = [r for r in RESULTS if r["area"] == a]
        lines.append(f"| {a} | {sum(r['status'] == 'PASS' for r in rs)} | {sum(r['status'] == 'FAIL' for r in rs)} | {sum(r['status'] == 'SKIP' for r in rs)} |")
    for a in areas:
        lines += ["", f"## {a}", "", "| ID | Test case | Expected | Actual | Result |", "|---|---|---|---|---|"]
        for r in [r for r in RESULTS if r["area"] == a]:
            icon = {"PASS": "✅ PASS", "FAIL": "❌ FAIL", "SKIP": "⏭ SKIP"}[r["status"]]
            esc = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
            lines.append(f"| {r['id']} | {esc(r['title'])} | {esc(r['expected'])} | {esc(r['actual'])} | {icon} |")
    path_md.write_text("\n".join(lines) + "\n")
    return tot


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--no-network", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "docs" / "qa-results"))
    ap.add_argument("--label", default="latest run")
    a = ap.parse_args()
    NO_NET = a.no_network
    run_python()
    if not a.no_browser:
        run_browser()
    tot = report(Path(a.out + ".md"), Path(a.out + ".json"), a.label)
    for r in RESULTS:
        if r["status"] != "PASS":
            print(f"{r['status']}  {r['id']}  {r['title']}  ->  {r['actual'][:200]}")
    print(f"\n{len(RESULTS)} cases: {tot['PASS']} pass, {tot['FAIL']} fail, {tot['SKIP']} skip. Artifacts in {TMP}")
    sys.exit(1 if tot["FAIL"] else 0)
