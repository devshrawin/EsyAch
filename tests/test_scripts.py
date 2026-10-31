"""Unit tests for the stdlib scripts.  Run: python3 -m unittest discover -s tests -p 'test_*.py'"""
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import fm_common  # noqa: E402
import validate  # noqa: E402
from inventory import Inventory  # noqa: E402

SHOP = ROOT / "examples" / "shop-demo"
ARCH = SHOP / ".flowmap" / "architecture.json"


class SafeZip(unittest.TestCase):
    def test_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as d:
            z = Path(d) / "evil.zip"
            with zipfile.ZipFile(z, "w") as zf:
                zf.writestr("../escape.txt", "x")
            with self.assertRaises(fm_common.UnsafeArchive):
                fm_common.safe_extract_zip(z, Path(d) / "out")
            self.assertFalse((Path(d) / "escape.txt").exists())

    def test_rejects_absolute_and_bomb(self):
        with tempfile.TemporaryDirectory() as d:
            z = Path(d) / "abs.zip"
            with zipfile.ZipFile(z, "w") as zf:
                zf.writestr("/etc/x", "x")
            with self.assertRaises(fm_common.UnsafeArchive):
                fm_common.safe_extract_zip(z, Path(d) / "o1")
            b = Path(d) / "bomb.zip"
            with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("a.txt", "0" * 50_000_000)
            with self.assertRaises(fm_common.UnsafeArchive):
                fm_common.safe_extract_zip(b, Path(d) / "o2")

    def test_size_cap_counts_streamed_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            z = Path(d) / "big.zip"
            with zipfile.ZipFile(z, "w") as zf:
                zf.writestr("a.bin", b"x" * 5000)
            with self.assertRaises(fm_common.UnsafeArchive):
                fm_common.safe_extract_zip(z, Path(d) / "o", max_total=1000)


class Walk(unittest.TestCase):
    def test_gitignore_lockfiles_binaries(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d)
            (r / ".gitignore").write_text("secret/\n*.log\n!keep.log\n", encoding="utf-8")
            for rel, data in {"a.py": "x", "secret/b.py": "x", "x.log": "x", "keep.log": "x",
                              "package-lock.json": "{}", "node_modules/m.js": "x", "img.png": "x"}.items():
                (r / rel).parent.mkdir(parents=True, exist_ok=True)
                (r / rel).write_text(data, encoding="utf-8")
            (r / "big.txt").write_text("y" * 1_100_000, encoding="utf-8")
            files, skipped = fm_common.walk_repo(r)
            names = sorted(f for f, _ in files)
            self.assertEqual(names, [".gitignore", "a.py", "keep.log"])
            self.assertEqual(skipped.get("over_1mb"), 1)


class InventoryShop(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        inv = Inventory(SHOP.resolve(), "shop-demo")
        inv.run()
        cls.d = inv.to_json()

    def test_routes_webhook_cron(self):
        eps = self.d["entrypoints"]
        routes = {(e.get("method"), e.get("path")) for e in eps if e["kind"] in ("http_route", "webhook")}
        self.assertIn(("POST", "/api/orders"), routes)
        self.assertTrue(any(e["kind"] == "webhook" for e in eps))
        self.assertTrue(any(e["kind"] == "cron" and e.get("schedule") == "0 2 * * *" for e in eps))

    def test_flagged_off_and_dead_code(self):
        refund = next(e for e in self.d["entrypoints"] if e.get("symbol") == "refund")
        self.assertEqual(refund.get("status"), "deactivated")
        reasons = {d["reason"] for d in self.d["dead_code"]}
        self.assertIn("commented-out route", reasons)
        self.assertIn("only called from deactivated code", reasons)

    def test_call_graph_and_externals(self):
        self.assertTrue(any(c["caller"] == "checkout" and c["callee"] == "create_order" for c in self.d["calls"]))
        self.assertTrue(any(x.get("sdk") == "Stripe" for x in self.d["externals"]))
        self.assertIn("STRIPE_SECRET_KEY", self.d["env_vars"])
        self.assertTrue(any(h["url"].endswith("/orders") and h["method"] == "POST" for h in self.d["http_clients"]))


class Validate(unittest.TestCase):
    def test_fixture_is_valid(self):
        rep = validate.validate(json.loads(ARCH.read_text(encoding="utf-8")), SHOP)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.warnings, [])

    def test_catches_broken_flow_and_bad_evidence(self):
        g = json.loads(ARCH.read_text(encoding="utf-8"))
        g["flows"][0]["steps"][2]["edge"] = "e_ui_signup"
        g["nodes"][0]["evidence"] = [{"file": "web/src/api.ts", "line": 9999}]
        errs = "\n".join(validate.validate(g, SHOP).errors)
        self.assertIn("goes to", errs)
        self.assertIn("beyond end of file", errs)

    def test_inferred_edge_rules(self):
        g = json.loads(ARCH.read_text(encoding="utf-8"))
        g["edges"][0].update(inferred=True, confidence="high")
        errs = "\n".join(validate.validate(g).errors)
        self.assertIn("cannot be high confidence", errs)
        self.assertIn("need a 'reason'", errs)


class Build(unittest.TestCase):
    def test_build_embeds_and_escapes(self):
        g = json.loads(ARCH.read_text(encoding="utf-8"))
        g["project"]["summary"] = "tricky </script><!-- text"
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "g.json"
            src.write_text(json.dumps(g), encoding="utf-8")
            out = Path(d) / "o.html"
            subprocess.run([sys.executable, str(ROOT / "scripts" / "build.py"), str(src), "-o", str(out)], check=True, capture_output=True)
            html = out.read_text(encoding="utf-8")
            self.assertNotIn("__FLOWMAP_DATA__", html)
            self.assertNotIn("tricky </script>", html)
            self.assertIn("tricky <\\/script><\\!--", html)


if __name__ == "__main__":
    unittest.main()
