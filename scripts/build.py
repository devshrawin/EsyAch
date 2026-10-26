#!/usr/bin/env python3
"""Render a flowmap graph into ONE self-contained, offline HTML file.

Usage: build.py <graph.json> -o <out.html> [--template viewer/dist/index.html]

The viewer template is prebuilt (React + xyflow + elkjs, inlined by vite-plugin-singlefile),
so users of the plugin need Python only, no npm. The graph JSON is embedded in a
<script type="application/json"> tag; nothing is fetched at runtime.
"""
from __future__ import annotations

import argparse
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
    args = ap.parse_args()
    if not args.template.is_file():
        raise SystemExit(f"viewer template not found: {args.template} (run `npm run build` in viewer/)")
    graph = json.loads(args.graph.read_text(encoding="utf-8"))
    html = build(graph, args.template)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    size = args.out.stat().st_size
    print(f"wrote {args.out} ({size / 1024 / 1024:.1f} MB)")
    if size > WARN_BYTES:
        print(f"WARNING: output is larger than {WARN_BYTES // 1024 // 1024} MB; consider fewer/smaller screenshots", file=sys.stderr)


if __name__ == "__main__":
    main()
