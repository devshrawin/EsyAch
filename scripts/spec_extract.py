#!/usr/bin/env python3
"""Extract structured text from an SRS (PDF, DOCX, Markdown or plain text) -> spec_text.json.

Usage: spec_extract.py <srs file> [-o spec_text.json]

Keeps headings (with numbering), list items, tables and requirement IDs (FR-12, NFR-3, REQ-3.2,
BR-1, US-4, UC-2, SR-7) with their text, priority and section. Also flags e-mail addresses and phone
numbers that look real, so the user can be warned before anything is shared.

DOCX, MD and TXT need only the stdlib. PDF uses pypdf when installed, else the `pdftotext` CLI.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fm_common import dump_json  # noqa: E402

REQ_ID = re.compile(r"\b((?:FR|NFR|REQ|BR|US|UC|SR)[-_.]?\d+(?:\.\d+)*)\b")
REQ_DEF = re.compile(r"^[^\w(]*((?:FR|NFR|REQ|BR|US|UC|SR)[-_.]?\d+(?:\.\d+)*)\s*(?:\((High|Medium|Low|Must|Should|Could|Won't)\))?\s*[:.\-–]?\s*(.*)$", re.I)
NUM_HEADING = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+([A-Z][^.]{1,80})$")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\w)(?<!\d\.)\+?\(?\d[\d\s().-]{7,18}\d(?!\w|\.\d)")  # then 9-15 digits, see _phone_ok
SAFE_EMAIL = re.compile(r"@(example|test|invalid|localhost)\b|@(example|test)\.(com|org|net)$", re.I)
NO_UI = re.compile(r"no (user )?interface|non-ui|no ui\b|backend only", re.I)

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A_BLIP = "{http://schemas.openxmlformats.org/drawingml/2006/main}blip"
V_IMG = "{urn:schemas-microsoft-com:vml}imagedata"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"


# ------------------------------------------------------------------ readers -> blocks

def blocks_md(text: str, plain: bool = False):
    out, lines, i = [], text.splitlines(), 0
    while i < len(lines):
        raw = lines[i]
        line = raw.strip()
        loc = f"line {i + 1}"
        if not line:
            i += 1
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m and not plain:
            out.append({"type": "heading", "level": len(m.group(1)), "text": _clean(m.group(2)), "loc": loc})
        elif plain and (NUM_HEADING.match(line) or (line.isupper() and len(line) < 80 and len(line.split()) <= 8)):
            lvl = NUM_HEADING.match(line).group(1).count(".") + 1 if NUM_HEADING.match(line) else 1
            out.append({"type": "heading", "level": lvl, "text": line, "loc": loc})
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [_clean(c) for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c.strip()) for c in cells):
                    rows.append(cells)
                i += 1
            out.append({"type": "table", "rows": rows, "loc": loc})
            continue
        elif re.match(r"^([-*+]|\d+[.)])\s+", line):
            item = re.sub(r"^([-*+]|\d+[.)])\s+", "", line)
            # continuation lines (indented)
            while i + 1 < len(lines) and lines[i + 1].startswith(("  ", "\t")) and lines[i + 1].strip():
                i += 1
                item += " " + lines[i].strip()
            out.append({"type": "list", "text": _clean(item), "loc": loc})
        elif i + 1 < len(lines) and re.fullmatch(r"(=+|-+)", lines[i + 1].strip() or "x") and not plain:
            out.append({"type": "heading", "level": 1 if lines[i + 1].strip()[0] == "=" else 2, "text": _clean(line), "loc": loc})
            i += 1
        else:
            para = line
            while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r"^(#|\||[-*+]\s|\d+[.)]\s)", lines[i + 1].strip()) \
                    and not REQ_DEF.match(lines[i + 1].strip()):
                i += 1
                para += " " + lines[i].strip()
            out.append({"type": "para", "text": _clean(para), "loc": loc})
        i += 1
    return out


def blocks_docx(path: Path):
    with zipfile.ZipFile(path) as zf:
        if "word/document.xml" not in zf.namelist():
            raise SystemExit("not a .docx (word/document.xml missing)")
        info = zf.getinfo("word/document.xml")
        if info.file_size > 50_000_000:
            raise SystemExit("document.xml too large")
        root = ET.fromstring(zf.read("word/document.xml"))
        styles = {}
        if "word/styles.xml" in zf.namelist():
            sroot = ET.fromstring(zf.read("word/styles.xml"))
            for st in sroot.iter(f"{W}style"):
                sid = st.get(f"{W}styleId")
                name = st.find(f"{W}name")
                if sid and name is not None:
                    styles[sid] = name.get(f"{W}val", sid)
        rels = {}
        if "word/_rels/document.xml.rels" in zf.namelist():
            for r in ET.fromstring(zf.read("word/_rels/document.xml.rels")).iter(PKG_REL):
                if r.get("TargetMode") != "External":
                    rels[r.get("Id")] = "word/" + r.get("Target", "").lstrip("/").removeprefix("word/")
    body = root.find(f"{W}body")
    out, n = [], 0

    def images(el):
        """Embedded pictures inside a paragraph/table, as zip paths (external links are ignored)."""
        found = []
        for b in el.iter(A_BLIP):
            rid = b.get(f"{R}embed")
            if rid in rels:
                found.append(rels[rid])
        for v in el.iter(V_IMG):
            rid = v.get(f"{R}id")
            if rid in rels:
                found.append(rels[rid])
        return found

    def ptext(p):
        return "".join(t.text or "" for t in p.iter(f"{W}t"))

    def cell_text(c):
        """Cell text with one line per paragraph (nested tables flattened row by row)."""
        lines = [_clean(ptext(p)) for p in c.iter(f"{W}p")]
        return "\n".join(x for x in lines if x)

    for el in body:
        if el.tag == f"{W}p":
            n += 1
            txt = _clean(ptext(el))
            for img in images(el):
                out.append({"type": "image", "image": img, "loc": f"paragraph {n}"})
            if not txt:
                continue
            ps = el.find(f"{W}pPr/{W}pStyle")
            style = styles.get(ps.get(f"{W}val"), ps.get(f"{W}val")) if ps is not None else ""
            m = re.match(r"(?i)heading\s*(\d)", style or "")
            if m or (style or "").lower() == "title":
                out.append({"type": "heading", "level": int(m.group(1)) if m else 1, "text": txt, "loc": f"paragraph {n}"})
            elif el.find(f"{W}pPr/{W}numPr") is not None or (style or "").lower().startswith("list"):
                out.append({"type": "list", "text": txt, "loc": f"paragraph {n}"})
            else:
                out.append({"type": "para", "text": txt, "loc": f"paragraph {n}"})
        elif el.tag == f"{W}tbl":
            rows = [[cell_text(c) for c in tr.findall(f"{W}tc")] for tr in el.iter(f"{W}tr")]
            out.append({"type": "table", "rows": rows, "loc": f"table after paragraph {n}"})
            for img in images(el):
                out.append({"type": "image", "image": img, "loc": f"table after paragraph {n}"})
    return out


def pdf_pages(path: Path) -> list[str]:
    try:
        from pypdf import PdfReader  # type: ignore
        return [p.extract_text() or "" for p in PdfReader(str(path)).pages]
    except ImportError:
        pass
    if shutil.which("pdftotext"):
        res = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, timeout=120)
        return res.stdout.split("\f")
    raise SystemExit("PDF needs `pip install pypdf` or the pdftotext CLI (or extract the text with the pdf skill first)")


def blocks_pdf(path: Path):
    out = []
    for pno, page in enumerate(pdf_pages(path), 1):
        buf: list[str] = []

        def flush():
            if buf:
                out.append({"type": "para", "text": _clean(" ".join(buf)), "loc": f"page {pno}"})
                buf.clear()

        for raw in page.splitlines():
            line = raw.strip()
            if not line:
                flush()
                continue
            if NUM_HEADING.match(line):
                flush()
                out.append({"type": "heading", "level": NUM_HEADING.match(line).group(1).count(".") + 1, "text": line, "loc": f"page {pno}"})
            elif REQ_DEF.match(line) or re.match(r"^[•\-*]\s+", line):
                flush()
                buf.append(re.sub(r"^[•\-*]\s+", "", line))
            else:
                buf.append(line)
        flush()
    # A requirement paragraph that swallowed the next one: split on embedded IDs at sentence starts.
    fixed = []
    for b in out:
        parts = re.split(r"(?<=[.)])\s+(?=(?:FR|NFR|REQ|BR|US|UC|SR)[-_.]?\d)", b["text"])
        fixed += [{**b, "text": p} for p in parts]
    return fixed


def _clean(s: str) -> str:
    if "\n" in s:
        return "\n".join(_clean(x) for x in s.split("\n"))
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u201e", '"').replace("\u2018", "'").replace("\u2019", "'")
    s = re.sub(r"\*\*|__|`", "", s)
    s = re.sub(r"(?<!\w)\*(?!\s)|(?<!\s)\*(?!\w)", "", s)
    return re.sub(r"\s+", " ", s).strip()


# ------------------------------------------------------------------ structure

GENERIC_HEADINGS = re.compile(r"(?i)^(screens?(\(s\))?|use cases?|wireframes?(\(s\))?|mock-?ups?|ui|figures?|description)$")
UC_KEYS = re.compile(r"(?i)^(use case|requirement|story|feature|req)\s*(id|no\.?|number|#)\s*:?$")


def use_case(rows):
    """A key/value table with a 'Use Case ID' (or Requirement ID) row -> requirement record."""
    kv = {}
    for r in rows:
        if len(r) >= 2 and r[0] and len(r[0]) < 60:
            k = re.sub(r"[:\s]+$", "", r[0]).strip()
            kv.setdefault(k.lower(), r[1])
    key = next((k for k in kv if UC_KEYS.match(k)), None)
    if not key:
        return None
    rid = kv[key].split("\n")[0].strip()
    if not rid or len(rid) > 60:
        return None
    name = kv.get("use case name") or kv.get("name") or kv.get("title") or ""
    text = " — ".join(x for x in [name.replace("\n", " "), (kv.get("objective") or kv.get("description") or "").split("\n")[0]] if x)
    fields = []
    for r in rows:  # data-field rows: '#', 'Field Title', 'Input Control', ...
        if len(r) >= 3 and re.fullmatch(r"\d{1,3}", r[0] or "") and r[1]:
            fields.append({"no": int(r[0]), "title": r[1], "control": r[2] if len(r) > 2 else "",
                           "mandatory": r[3] if len(r) > 3 else "", "validation": r[-1] if len(r) > 5 else ""})
    detail = {k: v for k, v in kv.items() if k in ("actors", "objective", "description", "pre-conditions", "post conditions",
                                                     "normal course", "alternative courses", "exception flow", "business rules")}
    return {"id": rid, "text": text or rid, "priority": (kv.get("priority") or "").split("\n")[0].capitalize() or None,
            "kind": "use_case", "detail": detail, "fields": fields}


def structure(blocks, source: str, fmt: str):
    sections, reqs, pii, figures = [], {}, [], []
    current = ""
    topic = ""  # nearest meaningful heading (skips 'Screen(s)', 'Use Case' ...)
    for i, b in enumerate(blocks):
        if b["type"] == "image":
            figures.append({"image": b["image"], "section": topic, "loc": b["loc"], "caption": _caption(blocks, i)})
            continue
        if b["type"] == "heading" and not GENERIC_HEADINGS.match(b["text"].strip()):
            topic = b["text"]
        if b["type"] == "table":
            uc = use_case(b["rows"])
            if uc and uc["id"] not in reqs:
                uc.update(section=topic, loc=b["loc"], ui=True)
                reqs[uc["id"]] = uc
                continue
        if b["type"] == "heading":
            current = b["text"]
            sections.append({"title": b["text"], "level": b["level"], "loc": b["loc"]})
            continue
        texts = [b["text"]] if b["type"] != "table" else [" | ".join(r) for r in b["rows"]]
        for t in texts:
            for m in EMAIL.finditer(t):
                if not SAFE_EMAIL.search(m.group(0)):
                    pii.append({"kind": "email", "value": _mask(m.group(0)), "loc": b["loc"]})
            for m in PHONE.finditer(t):
                digits = re.sub(r"\D", "", m.group(0))
                if _luhn(digits) and 13 <= len(digits) <= 19:
                    pii.append({"kind": "card_number", "value": _mask(m.group(0)), "loc": b["loc"]})
                elif 9 <= len(digits) <= 15 and not re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", m.group(0)):
                    pii.append({"kind": "phone", "value": _mask(m.group(0)), "loc": b["loc"]})
            d = REQ_DEF.match(t)
            if d and d.group(1).upper() not in reqs:
                rid = d.group(1).upper().replace("_", "-")
                body = d.group(3).strip().lstrip("|").strip()
                reqs[rid] = {
                    "id": rid, "text": body, "priority": (d.group(2) or "").capitalize() or None,
                    "section": current, "loc": b["loc"],
                    # non-functional requirements are not expected on a screen unless the text says so
                    "ui": not NO_UI.search(body) and (_kind(rid) != "nonfunctional" or bool(re.search(r"(?i)\b(screen|page|form|button)\b", body))),
                    "kind": _kind(rid),
                }
    refs = {}
    for b in blocks:
        if b["type"] == "image":
            continue
        for t in ([b.get("text", "")] if b["type"] != "table" else [" ".join(r) for r in b["rows"]]):
            for m in REQ_ID.finditer(t):
                refs.setdefault(m.group(1).upper(), []).append(b["loc"])
    return {
        "tool": "flowmap-spec-extract/0.1", "source": source, "format": fmt,
        "sections": sections, "requirements": list(reqs.values()),
        "references": {k: v for k, v in refs.items() if k not in reqs or len(v) > 1},
        "pii": pii, "figures": figures, "blocks": blocks,
    }


def _caption(blocks, i):
    """'Figure 3: Scheme list' style text right after (or before) an image, else ''."""
    for j in (i + 1, i - 1, i + 2):
        if 0 <= j < len(blocks) and blocks[j]["type"] in ("para", "list"):
            t = blocks[j]["text"]
            if re.match(r"(?i)^(fig(ure)?|screen(shot)?|image)\s*[\d.:-]", t) or (len(t) < 90 and j == i + 1):
                return t[:120]
    return ""


def _kind(rid: str) -> str:
    p = re.match(r"[A-Z]+", rid).group(0)
    return {"FR": "functional", "REQ": "functional", "NFR": "nonfunctional", "BR": "business_rule",
            "US": "user_story", "UC": "use_case", "SR": "security"}.get(p, "functional")


def _luhn(d: str) -> bool:
    if not d:
        return False
    tot = 0
    for i, c in enumerate(reversed(d)):
        n = int(c) * (2 if i % 2 else 1)
        tot += n - 9 if n > 9 else n
    return tot % 10 == 0


def _mask(v: str) -> str:
    return v[:2] + "…" + v[-4:] if len(v) > 8 else "…"


def extract(path: Path):
    ext = path.suffix.lower()
    if ext == ".pdf":
        return structure(blocks_pdf(path), str(path), "pdf")
    if ext == ".docx":
        return structure(blocks_docx(path), str(path), "docx")
    if ext in (".md", ".markdown"):
        return structure(blocks_md(path.read_text(encoding="utf-8", errors="replace")), str(path), "md")
    if ext in (".txt", ".text", ""):
        return structure(blocks_md(path.read_text(encoding="utf-8", errors="replace"), plain=True), str(path), "txt")
    raise SystemExit(f"unsupported SRS format: {ext} (PDF, DOCX, MD or TXT)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("srs", type=Path)
    ap.add_argument("-o", "--out", type=Path)
    a = ap.parse_args()
    if not a.srs.is_file():
        raise SystemExit(f"not found: {a.srs}")
    if a.srs.stat().st_size > 50_000_000:
        raise SystemExit("SRS file over 50 MB")
    data = extract(a.srs)
    data["source"] = a.srs.name
    dump_json(data, a.out)
    if a.out:
        ui = sum(r["ui"] for r in data["requirements"])
        print(f"spec: {len(data['sections'])} sections, {len(data['requirements'])} requirements ({ui} with UI) -> {a.out}", file=sys.stderr)
    if data["pii"]:
        print(f"WARNING: {len(data['pii'])} possible real e-mail/phone value(s) in the SRS: {data['pii'][:5]}", file=sys.stderr)


if __name__ == "__main__":
    main()
