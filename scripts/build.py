#!/usr/bin/env python3
"""Render a flowmap graph into ONE self-contained, offline HTML file.

Usage: build.py <graph.json> -o <out.html> [--template viewer/dist/index.html]

The viewer template is prebuilt (React + xyflow + elkjs, inlined by vite-plugin-singlefile),
so users of the plugin need Python only, no npm. The graph JSON is embedded in a
<script type="application/json"> tag; nothing is fetched at runtime.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_TEMPLATE = HERE.parent / "viewer" / "dist" / "index.html"
PLACEHOLDER = '<script id="flowmap-data" type="application/json">__FLOWMAP_DATA__</script>'
WARN_BYTES = 50 * 1024 * 1024


def embed_json(graph: dict) -> str:
    text = json.dumps(graph, ensure_ascii=False, separators=(",", ":"))
    # Keep the JSON from closing the <script> element or opening an HTML comment.
    return text.replace("</", "<\\/").replace("<!--", "<\\!--")


MAX_IMG_W = 1200
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def image_names(graph: dict) -> list[str]:
    names = []
    for n in graph.get("nodes", []):
        if n.get("image"):
            names.append(n["image"])
        names += [v["image"] for v in n.get("variants", []) if v.get("image")]
    return list(dict.fromkeys(names))


def encode_image(path: Path) -> str:
    """Downscale to MAX_IMG_W and re-encode as WebP (falls back to the original bytes without Pillow)."""
    try:
        from PIL import Image  # type: ignore
        Image.MAX_IMAGE_PIXELS = 60_000_000
        with Image.open(path) as im:
            im.load()
            if im.width > MAX_IMG_W:
                im = im.resize((MAX_IMG_W, round(im.height * MAX_IMG_W / im.width)), Image.LANCZOS)
            buf = io.BytesIO()
            im.convert("RGB").save(buf, "WEBP", quality=82, method=4)
            return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        mime = MIME.get(path.suffix.lower(), "application/octet-stream")
        return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def embed_images(graph: dict, screens_dir: Path) -> dict:
    """Mode B: put every screenshot into graph['assets'] as a data: URI so the HTML stays offline."""
    assets, missing = {}, []
    for name in image_names(graph):
        p = (screens_dir / name).resolve()
        if screens_dir.resolve() not in p.parents or not p.is_file():
            missing.append(name)
            continue
        assets[name] = encode_image(p)
    if missing:
        print(f"WARNING: {len(missing)} screenshot(s) not found in {screens_dir}: {missing[:5]}", file=sys.stderr)
    return {**graph, "assets": assets}


def build(graph: dict, template: Path) -> str:
    html = template.read_text(encoding="utf-8")
    if html.count(PLACEHOLDER) != 1:
        raise SystemExit(f"template {template} has no single data placeholder; rebuild the viewer")
    tag = f'<script id="flowmap-data" type="application/json">{embed_json(graph)}</script>'
    return html.replace(PLACEHOLDER, tag, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("graph", type=Path)
    ap.add_argument("-o", "--out", type=Path, required=True)
    ap.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    ap.add_argument("--screens", type=Path, help="Mode B: screenshot folder (default: project.screens_dir next to the JSON)")
    ap.add_argument("--theme", choices=["dark", "midnight", "light", "paper", "blueprint"],
                    help="theme the file opens in (viewers can still switch); 'paper' suits documents and print")
    args = ap.parse_args()
    if not args.template.is_file():
        raise SystemExit(f"viewer template not found: {args.template} (run `npm run build` in viewer/)")
    graph = json.loads(args.graph.read_text(encoding="utf-8"))
    if graph.get("mode") == "spec":
        sd = args.screens or (args.graph.parent / graph.get("project", {}).get("screens_dir", "screens"))
        graph = embed_images(graph, sd)
        print(f"embedded {len(graph['assets'])} screenshot(s) from {sd}")
    if args.theme:
        graph = {**graph, "view": {**graph.get("view", {}), "theme": args.theme}}
    html = build(graph, args.template)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    size = args.out.stat().st_size
    print(f"wrote {args.out} ({size / 1024 / 1024:.1f} MB)")
    if size > WARN_BYTES:
        print(f"WARNING: output is larger than {WARN_BYTES // 1024 // 1024} MB; consider fewer/smaller screenshots", file=sys.stderr)


if __name__ == "__main__":
    main()
