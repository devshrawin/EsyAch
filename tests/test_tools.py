"""Unit tests for the Python tools.  Run: python3 -m unittest discover -s tests -p 'test_*.py'"""
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "plugins" / "esyach" / "tools"
sys.path.insert(0, str(TOOLS))

import common as fm_common  # noqa: E402
import extract_srs  # noqa: E402
from inventory import Inventory  # noqa: E402

SPEC = ROOT / "examples" / "shop-spec"


class ExtractSrs(unittest.TestCase):
    def test_same_requirements_from_md_docx_pdf(self):
        for name in ("srs.md", "srs.docx", "srs.pdf"):
            with self.subTest(name=name):
                d = extract_srs.extract(SPEC / name)
                ids = [r["id"] for r in d["requirements"]]
                self.assertEqual(len(ids), 19, ids)
                self.assertIn("FR-2", ids)
                no_ui = sorted(r["id"] for r in d["requirements"] if not r["ui"])
                self.assertEqual(no_ui, ["FR-12", "NFR-1", "NFR-2"])
                self.assertFalse(any(r.get("auto") for r in d["requirements"]))

    def test_numbers_shall_statements_when_no_ids(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "lib.md"
            p.write_text("# Library\n\n## Loans\n\nMembers shall borrow up to 5 books. The system must e-mail a reminder (no user interface).\n\n"
                         "## Performance\n\n- Search should answer in under 1 second.\n- Nice to have a dark mode\n")
            reqs = extract_srs.extract(p)["requirements"]
            self.assertEqual([r["id"] for r in reqs], ["R-001", "R-002", "R-003"])
            self.assertTrue(all(r["auto"] for r in reqs))
            self.assertFalse(reqs[1]["ui"])
            self.assertEqual(reqs[2]["kind"], "nonfunctional")

    def test_warns_on_real_looking_personal_data(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.md"
            p.write_text("- FR-1: Contact jane.doe@acme-corp.com or +1 415 555 0134. Test card 4242 4242 4242 4242.\n- FR-2: Use admin@example.com.\n")
            kinds = sorted({x["kind"] for x in extract_srs.extract(p)["pii"]})
            self.assertEqual(kinds, ["card_number", "email", "phone"])


class ScreensPrep(unittest.TestCase):
    def test_manifest_grid_and_web_copies(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run([sys.executable, str(TOOLS / "screens_prep.py"), str(SPEC / "screens"), "-o", d], check=True, capture_output=True)
            m = json.loads((Path(d) / "screens_manifest.json").read_text())
            self.assertEqual(m["count"], 8)
            pair = {s["file"]: s["near_duplicates"] for s in m["screens"]}
            self.assertEqual(pair["01-sign-in.png"], ["02-sign-in-error.png"])
            self.assertTrue((Path(d) / "grid" / "01-sign-in.png").is_file())
            web = Path(d) / "web" / "01-sign-in.webp"
            self.assertTrue(web.is_file())
            self.assertLess(web.stat().st_size, (SPEC / "screens" / "01-sign-in.png").stat().st_size)


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
            (r / ".gitignore").write_text("secret/\n*.log\n!keep.log\n")
            for rel, data in {"a.py": "x", "secret/b.py": "x", "x.log": "x", "keep.log": "x",
                              "package-lock.json": "{}", "node_modules/m.js": "x", "img.png": "x"}.items():
                (r / rel).parent.mkdir(parents=True, exist_ok=True)
                (r / rel).write_text(data)
            (r / "big.txt").write_text("y" * 1_100_000)
            files, skipped = fm_common.walk_repo(r)
            names = sorted(f for f, _ in files)
            self.assertEqual(names, [".gitignore", "a.py", "keep.log"])
            self.assertEqual(skipped.get("over_1mb"), 1)



class InventorySelf(unittest.TestCase):
    def test_reads_python_without_running_it(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d)
            (r / "app.py").write_text("from fastapi import FastAPI\nimport redis\napp = FastAPI()\n\n@app.post('/api/orders')\ndef create():\n    return 1\n")
            inv = Inventory(r.resolve(), "t")
            inv.run()
            out = inv.to_json()
            routes = {(e.get("method"), e.get("path")) for e in out["entrypoints"]}
            self.assertIn(("POST", "/api/orders"), routes)


if __name__ == "__main__":
    unittest.main()
