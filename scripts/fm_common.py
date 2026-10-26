"""Shared helpers for flowmap scripts. Python stdlib only.

Nothing in here executes code from the analysed repository. We do not even call
`git ls-files` on a target, because a hostile .git/config (core.fsmonitor, etc.)
could run commands; .gitignore is parsed by hand instead.
"""
from __future__ import annotations

import json
import os
import re
import stat
import zipfile
from pathlib import Path

MAX_FILE_BYTES = 1_000_000

SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "vendor", "bower_components", "dist", "build", "out",
    "target", ".next", ".nuxt", ".svelte-kit", ".output", "__pycache__", ".venv", "venv", "env",
    ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "coverage", ".cache", ".gradle",
    ".idea", ".vscode", ".flowmap", "site-packages", "Pods", ".terraform",
}

LOCKFILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json", "bun.lockb",
    "poetry.lock", "Pipfile.lock", "uv.lock", "pdm.lock", "Cargo.lock", "go.sum",
    "composer.lock", "Gemfile.lock", "mix.lock", "packages.lock.json", "flake.lock",
}

BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".icns", ".tiff", ".psd", ".svgz",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".gz", ".tgz", ".bz2",
    ".xz", ".7z", ".rar", ".tar", ".jar", ".war", ".class", ".so", ".dll", ".dylib", ".exe",
    ".bin", ".o", ".a", ".pyc", ".pyo", ".wasm", ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav", ".ogg", ".flac", ".sqlite", ".db",
    ".parquet", ".pkl", ".npy", ".npz", ".h5", ".onnx", ".pt", ".ckpt", ".safetensors",
}

MINIFIED_RE = re.compile(r"\.min\.(js|css)$")


# --------------------------------------------------------------------------- gitignore

class GitIgnore:
    """Minimal .gitignore semantics: comments, negation, anchoring, dir-only, *, **, ?."""

    def __init__(self):
        self.rules: list[tuple[str, re.Pattern, bool, bool]] = []  # (base, regex, negate, dir_only)

    @staticmethod
    def _to_regex(pat: str) -> str:
        out, i = [], 0
        while i < len(pat):
            c = pat[i]
            if c == "*":
                if pat[i:i + 3] == "**/":
                    out.append("(?:.*/)?")
                    i += 3
                    continue
                if pat[i:i + 2] == "**":
                    out.append(".*")
                    i += 2
                    continue
                out.append("[^/]*")
            elif c == "?":
                out.append("[^/]")
            elif c == "[":
                j = pat.find("]", i + 1)
                if j == -1:
                    out.append(re.escape(c))
                else:
                    cls = pat[i + 1:j].replace("\\", "\\\\")
                    if cls.startswith("!"):
                        cls = "^" + cls[1:]
                    out.append(f"[{cls}]")
                    i = j
            elif c == "\\" and i + 1 < len(pat):
                i += 1
                out.append(re.escape(pat[i]))
            else:
                out.append(re.escape(c))
            i += 1
        return "".join(out)

    def add_file(self, path: Path, base: str):
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return
        for raw in lines:
            line = raw.rstrip()
            if not line or line.startswith("#"):
                continue
            negate = line.startswith("!")
            if negate:
                line = line[1:]
            dir_only = line.endswith("/")
            line = line.rstrip("/")
            anchored = "/" in line
            line = line.lstrip("/")
            body = self._to_regex(line)
            rx = re.compile(("^" if anchored else r"^(?:.*/)?") + body + r"(?:/.*)?$")
            self.rules.append((base, rx, negate, dir_only))

    def ignored(self, rel: str, is_dir: bool) -> bool:
        result = False
        for base, rx, negate, dir_only in self.rules:
            if base:
                if not rel.startswith(base + "/"):
                    continue
                sub = rel[len(base) + 1:]
            else:
                sub = rel
            if dir_only and not is_dir:
                # Files inside an ignored dir never reach here: the walk prunes the dir.
                continue
            if rx.match(sub):
                result = not negate
        return result


def is_binary(path: Path) -> bool:
    if path.suffix.lower() in BINARY_EXT:
        return True
    try:
        with path.open("rb") as fh:
            return b"\0" in fh.read(8192)
    except OSError:
        return True


def walk_repo(root: Path, max_bytes: int = MAX_FILE_BYTES):
    """Yield (relative_posix_path, Path) for analysable text files; also returns skip stats.

    Never follows symlinks. Respects nested .gitignore files.
    """
    root = root.resolve()
    gi = GitIgnore()
    skipped: dict[str, int] = {}

    def skip(reason):
        skipped[reason] = skipped.get(reason, 0) + 1

    files: list[tuple[str, Path]] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        d = Path(dirpath)
        rel_dir = d.relative_to(root).as_posix()
        rel_dir = "" if rel_dir == "." else rel_dir
        if (d / ".gitignore").is_file():
            gi.add_file(d / ".gitignore", rel_dir)
        keep = []
        for name in sorted(dirnames):
            rel = f"{rel_dir}/{name}" if rel_dir else name
            p = d / name
            if p.is_symlink():
                skip("symlink")
            elif name in SKIP_DIRS or name.endswith(".egg-info"):
                skip("skipped_dir")
            elif gi.ignored(rel, True):
                skip("gitignored")
            else:
                keep.append(name)
        dirnames[:] = keep
        for name in sorted(filenames):
            rel = f"{rel_dir}/{name}" if rel_dir else name
            p = d / name
            if p.is_symlink():
                skip("symlink")
                continue
            if gi.ignored(rel, False):
                skip("gitignored")
                continue
            if name in LOCKFILES:
                skip("lockfile")
                continue
            if MINIFIED_RE.search(name):
                skip("minified")
                continue
            try:
                size = p.stat().st_size
            except OSError:
                skip("unreadable")
                continue
            if size > max_bytes:
                skip("over_1mb")
                continue
            if is_binary(p):
                skip("binary")
                continue
            files.append((rel, p))
    return files, skipped


# --------------------------------------------------------------------------- safe zip

class UnsafeArchive(Exception):
    pass


def safe_extract_zip(zip_path: Path, dest: Path, max_total: int = 1_000_000_000,
                     max_members: int = 50_000, max_ratio: int = 200,
                     allowed_ext: set[str] | None = None) -> list[Path]:
    """Extract a zip defensively.

    Rejects: absolute paths, drive letters, `..` traversal, symlinks, too many members,
    total uncompressed size over `max_total` (counted while streaming, not trusted from
    headers), and suspicious compression ratios (zip bombs). Nested archives are written
    as plain files and never extracted.
    """
    dest = dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    total = 0
    with zipfile.ZipFile(zip_path) as zf:
        infos = zf.infolist()
        if len(infos) > max_members:
            raise UnsafeArchive(f"too many entries ({len(infos)} > {max_members})")
        declared = sum(i.file_size for i in infos)
        if declared > max_total:
            raise UnsafeArchive(f"declared size {declared} exceeds cap {max_total}")
        for info in infos:
            name = info.filename.replace("\\", "/")
            if name.startswith("/") or re.match(r"^[A-Za-z]:", name):
                raise UnsafeArchive(f"absolute path in archive: {name!r}")
            parts = [p for p in name.split("/") if p not in ("", ".")]
            if any(p == ".." for p in parts):
                raise UnsafeArchive(f"path traversal in archive: {name!r}")
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise UnsafeArchive(f"symlink in archive: {name!r}")
            if not parts or name.endswith("/"):
                continue
            if parts[0] == "__MACOSX" or parts[-1] == ".DS_Store":
                continue
            if allowed_ext is not None and Path(parts[-1]).suffix.lower() not in allowed_ext:
                continue
            if info.compress_size and info.file_size > 1_000_000 and info.file_size / info.compress_size > max_ratio:
                raise UnsafeArchive(f"suspicious compression ratio for {name!r}")
            target = (dest / Path(*parts)).resolve()
            if dest not in target.parents:
                raise UnsafeArchive(f"entry escapes destination: {name!r}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, target.open("wb") as out:
                while True:
                    chunk = src.read(1 << 16)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_total:
                        raise UnsafeArchive(f"uncompressed size exceeds cap {max_total}")
                    out.write(chunk)
            written.append(target)
    return written


# --------------------------------------------------------------------------- io

def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def dump_json(obj, path: Path | None):
    text = json.dumps(obj, indent=2, ensure_ascii=False)
    if path is None:
        print(text)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
