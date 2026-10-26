#!/usr/bin/env python3
"""Prepare a screenshot set for Mode B -> screens_manifest.json (+ gridded copies for vision).

Usage: screens_prep.py <folder | .zip> -o OUT_DIR

- Zips are extracted safely (images only; traversal, symlinks and bombs are rejected).
- For each PNG/JPG/WebP: size, order hint from the filename, a perceptual hash, and the files it
  nearly duplicates (same screen in another state: empty/filled/error/modal).
- OUT_DIR/grid/<name>.png: a copy with a labelled 10 % grid, so the model can read normalised 0-1
  hotspot boxes off the image when it views it.
Requires Pillow (images cannot be decoded with the stdlib).
"""
from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fm_common import UnsafeArchive, dump_json, safe_extract_zip  # noqa: E402

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}
MAX_PIXELS = 60_000_000  # refuse decompression-bomb images


def _pil():
    try:
        from PIL import Image, ImageDraw  # type: ignore
        Image.MAX_IMAGE_PIXELS = MAX_PIXELS
        return Image, ImageDraw
    except ImportError:
        raise SystemExit("Mode B needs Pillow: pip install pillow")


HASH = 16  # 16x16 difference hash; near-duplicate when < 10 % of bits differ (tuned on real states)


def dhash(img, size=HASH) -> int:
    g = img.convert("L").resize((size + 1, size))
    px = g.tobytes()
    bits = 0
    for r in range(size):
        for c in range(size):
            bits = (bits << 1) | (px[r * (size + 1) + c] > px[r * (size + 1) + c + 1])
    return bits


def grid_copy(img, out: Path, ImageDraw):
    im = img.convert("RGB").copy()
    w, h = im.size
    d = ImageDraw.Draw(im, "RGBA")
    for k in range(1, 10):
        x, y = w * k / 10, h * k / 10
        d.line([(x, 0), (x, h)], fill=(255, 0, 90, 110), width=1)
        d.line([(0, y), (w, y)], fill=(255, 0, 90, 110), width=1)
        d.rectangle([x + 2, 2, x + 26, 16], fill=(255, 255, 255, 200))
        d.text((x + 4, 3), f".{k}", fill=(200, 0, 70, 255))
        d.rectangle([2, y + 2, 26, y + 16], fill=(255, 255, 255, 200))
        d.text((4, y + 3), f".{k}", fill=(200, 0, 70, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)


def prepare(src: Path, out_dir: Path, grid: bool = True):
    Image, ImageDraw = _pil()
    out_dir.mkdir(parents=True, exist_ok=True)
    if src.is_file() and src.suffix.lower() == ".zip":
        dest = out_dir / "screens"
        if dest.exists():
            shutil.rmtree(dest)
        try:
            safe_extract_zip(src, dest, max_total=500_000_000, allowed_ext=IMG_EXT)
        except UnsafeArchive as exc:
            raise SystemExit(f"unsafe archive rejected: {exc}")
        root = dest
    elif src.is_dir():
        root = src
    else:
        raise SystemExit(f"expected a folder or .zip of screenshots: {src}")

    files = sorted(p for p in root.rglob("*") if p.suffix.lower() in IMG_EXT and p.is_file() and not p.is_symlink()
                   and "grid" not in p.relative_to(root).parts)
    items = []
    for p in files:
        rel = p.relative_to(root).as_posix()
        try:
            with Image.open(p) as im:
                im.load()
                w, h = im.size
                hsh = dhash(im)
                if grid:
                    grid_copy(im, out_dir / "grid" / (Path(rel).with_suffix(".png")), ImageDraw)
        except Exception as exc:  # corrupt or bomb image
            items.append({"file": rel, "error": str(exc)[:200]})
            continue
        m = re.match(r"^(\d+)", Path(rel).name)
        items.append({
            "file": rel, "width": w, "height": h, "bytes": p.stat().st_size,
            "sha1": hashlib.sha1(p.read_bytes()).hexdigest()[:12],
            "dhash": f"{hsh:064x}", "order": int(m.group(1)) if m else None,
            "name_hint": re.sub(r"[-_]+", " ", re.sub(r"^\d+[-_ ]*", "", Path(rel).stem)).strip(),
        })
    ok = [i for i in items if "dhash" in i]
    for a in ok:
        a["near_duplicates"] = [b["file"] for b in ok if b is not a and
                                bin(int(a["dhash"], 16) ^ int(b["dhash"], 16)).count("1") < HASH * HASH * 0.10
                                and abs(a["width"] / a["height"] - b["width"] / b["height"]) < 0.05]
    manifest = {"tool": "flowmap-screens-prep/0.1", "root": str(root), "count": len(ok), "screens": items}
    dump_json(manifest, out_dir / "screens_manifest.json")
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("-o", "--out", type=Path, required=True)
    ap.add_argument("--no-grid", action="store_true")
    a = ap.parse_args()
    m = prepare(a.src, a.out, grid=not a.no_grid)
    dups = sum(1 for s in m["screens"] if s.get("near_duplicates"))
    errs = [s for s in m["screens"] if "error" in s]
    print(f"screens: {m['count']} images ({dups} with near-duplicates) from {m['root']} -> {a.out}/screens_manifest.json", file=sys.stderr)
    for e in errs:
        print(f"WARNING: could not read {e['file']}: {e['error']}", file=sys.stderr)
    print("REMINDER: look for real personal data (names, e-mails, card numbers, addresses) while viewing each screenshot.", file=sys.stderr)


if __name__ == "__main__":
    main()
