#!/usr/bin/env python3
"""Mode B gap report for a screens.json: coverage, dead ends, unreachable screens, findings.

Usage: gaps.py <screens.json> [--json] [--md report.md]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fm_spec import coverage  # noqa: E402


def markdown(g: dict, c: dict) -> str:
    label = {n["id"]: n.get("label", n["id"]) for n in g.get("nodes", [])}
    req = {r["id"]: r for r in g.get("requirements", [])}
    pct = 100 * len(c["requirements_covered"]) / max(1, c["requirements_total"])
    out = [f"# Coverage: {g['project']['name']}", "",
           f"- UI requirements covered by a screen: **{len(c['requirements_covered'])}/{c['requirements_total']} ({pct:.0f} %)**",
           f"- Non-UI requirements (not expected on a screen): {', '.join(c['non_ui_requirements']) or 'none'}",
           f"- Inferred transitions (dashed, to confirm): {len(c['inferred_transitions'])}", ""]

    def section(title, rows):
        out.append(f"## {title} ({len(rows)})")
        out.extend(rows or ["- none"])
        out.append("")

    section("Requirements with no screen", [f"- **{r}**: {req[r]['text']}" for r in c["requirements_without_screen"]])
    section("Screens with no requirement", [f"- {label[s]}" for s in c["screens_without_requirement"]])
    section("Dead-end screens (no way out)", [f"- {label[s]}" for s in c["dead_end_screens"]])
    section("Unreachable screens", [f"- {label[s]}" for s in c["unreachable_screens"]])
    section("Controls that lead nowhere", [f"- {label[h['screen']]}: '{h['label']}'" for h in c["hotspots_without_destination"]])
    section("Findings (contradictions, missing states)", [
        f"- **{f['type']}** ({f.get('severity', 'med')}) {f.get('req', '')} · {label.get(f.get('screen'), '')}: {f['text']}" for f in c["findings"]])
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("graph", type=Path)
    ap.add_argument("--json", action="store_true", help="print the raw coverage JSON")
    ap.add_argument("--md", type=Path, help="also write a Markdown report here")
    a = ap.parse_args()
    g = json.loads(a.graph.read_text(encoding="utf-8"))
    if g.get("mode") != "spec":
        raise SystemExit("gaps.py works on Mode B graphs (mode: spec)")
    c = coverage(g)
    md = markdown(g, c)
    if a.md:
        a.md.write_text(md + "\n", encoding="utf-8")
    print(json.dumps(c, indent=2) if a.json else md)


if __name__ == "__main__":
    main()
