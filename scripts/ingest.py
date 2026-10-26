#!/usr/bin/env python3
"""Resolve a Mode A target (local path | git URL | .zip) into a local directory.

Usage: ingest.py <target> [--workdir DIR]
Prints JSON: {"root": ..., "kind": "local|git|zip", "name": ..., "temp": bool}

Never executes or installs anything from the target. Git clones are shallow, hook-free,
LFS-free and submodule-free.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fm_common import UnsafeArchive, safe_extract_zip  # noqa: E402

URL_RE = re.compile(r"^(https://|git@)[\w.@:/~+-]+?(\.git)?/?$")
SHORT_GH_RE = re.compile(r"^(?:github\.com/)?([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")
MAX_CLONE_BYTES = 2_000_000_000


def _dir_size(root: Path) -> int:
    total = 0
    for dirpath, _, files in os.walk(root, followlinks=False):
        for f in files:
            try:
                total += os.lstat(os.path.join(dirpath, f)).st_size
            except OSError:
                pass
    return total


def clone(url: str, workdir: Path) -> Path:
    if not url.startswith(("https://", "git@")):
        raise SystemExit(f"refusing non-https URL: {url}")
    name = re.sub(r"\.git$", "", url.rstrip("/").split("/")[-1]) or "repo"
    dest = workdir / name
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_LFS_SKIP_SMUDGE="1", GIT_CONFIG_NOSYSTEM="1")
    cmd = [
        "git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never",
        "-c", "core.symlinks=false", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=",
        "clone", "--depth", "1", "--single-branch", "--no-tags", "--quiet", url, str(dest),
    ]
    res = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=600)
    if res.returncode != 0:
        raise SystemExit(f"git clone failed: {res.stderr.strip()}")
    if _dir_size(dest) > MAX_CLONE_BYTES:
        shutil.rmtree(dest, ignore_errors=True)
        raise SystemExit("cloned repository exceeds 2 GB cap")
    return dest


def unzip(path: Path, workdir: Path) -> Path:
    dest = workdir / path.stem
    try:
        safe_extract_zip(path, dest)
    except UnsafeArchive as exc:
        shutil.rmtree(dest, ignore_errors=True)
        raise SystemExit(f"unsafe archive rejected: {exc}")
    entries = [p for p in dest.iterdir() if p.name != "__MACOSX"]
    # Unwrap the common "single top-level folder" layout.
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest


def resolve(target: str, workdir: Path | None) -> dict:
    p = Path(target).expanduser()
    if p.exists():
        if p.is_dir():
            return {"root": str(p.resolve()), "kind": "local", "name": p.resolve().name, "temp": False}
        if p.suffix.lower() == ".zip":
            wd = workdir or Path(tempfile.mkdtemp(prefix="flowmap-"))
            root = unzip(p, wd)
            return {"root": str(root), "kind": "zip", "name": p.stem, "temp": True}
        raise SystemExit(f"unsupported file target: {target} (expected a directory or .zip)")
    url = target
    m = SHORT_GH_RE.match(target)
    if m and not target.startswith(("https://", "git@")) and "/" in target:
        url = f"https://github.com/{m.group(1)}/{m.group(2)}.git"
    if URL_RE.match(url):
        wd = workdir or Path(tempfile.mkdtemp(prefix="flowmap-"))
        root = clone(url, wd)
        return {"root": str(root), "kind": "git", "name": root.name, "temp": True, "url": url}
    raise SystemExit(f"target not found and not a recognised git URL: {target}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target")
    ap.add_argument("--workdir", type=Path, help="where to clone/extract (default: a new temp dir)")
    args = ap.parse_args()
    if args.workdir:
        args.workdir.mkdir(parents=True, exist_ok=True)
    print(json.dumps(resolve(args.target, args.workdir), indent=2))


if __name__ == "__main__":
    main()
