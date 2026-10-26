#!/usr/bin/env python3
"""Deterministic inventory of a codebase -> inventory.json. Python stdlib only.

Usage: inventory.py <root> [-o inventory.json]

Python is parsed with `ast`; JS/TS with regexes; Go/Java/Ruby/PHP/etc. get a small
regex fallback (imports, routes). The output is raw evidence for the analysis step:
every fact carries file + line. Nothing here executes the target's code.
"""
from __future__ import annotations

import argparse
import ast
import datetime as dt
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fm_common import dump_json, read_text, walk_repo  # noqa: E402

LANG_BY_EXT = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".go": "go", ".java": "java",
    ".kt": "kotlin", ".rb": "ruby", ".php": "php", ".rs": "rust", ".cs": "csharp", ".swift": "swift",
    ".scala": "scala", ".sql": "sql", ".sh": "shell", ".yml": "yaml", ".yaml": "yaml", ".json": "json",
    ".toml": "toml", ".md": "markdown", ".html": "html", ".css": "css", ".scss": "css", ".vue": "vue",
    ".svelte": "svelte", ".tf": "terraform", ".proto": "protobuf", ".graphql": "graphql",
}
JS_LANGS = {"javascript", "typescript", "vue", "svelte"}
HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options", "all", "route", "api_route", "websocket")

# Known SDK / client modules -> (category, label)
KNOWN_SDKS = {
    "stripe": ("external", "Stripe"), "boto3": ("external", "AWS SDK"), "botocore": ("external", "AWS SDK"),
    "requests": ("http_client", "requests"), "httpx": ("http_client", "httpx"), "aiohttp": ("http_client", "aiohttp"),
    "urllib.request": ("http_client", "urllib"), "smtplib": ("external", "SMTP"), "sendgrid": ("external", "SendGrid"),
    "twilio": ("external", "Twilio"), "openai": ("external", "OpenAI"), "anthropic": ("external", "Anthropic"),
    "google.cloud": ("external", "Google Cloud"), "firebase_admin": ("external", "Firebase"),
    "slack_sdk": ("external", "Slack"), "paypalrestsdk": ("external", "PayPal"),
    "redis": ("cache_or_queue", "Redis"), "pika": ("queue", "RabbitMQ"), "kafka": ("queue", "Kafka"),
    "confluent_kafka": ("queue", "Kafka"), "celery": ("queue", "Celery"), "rq": ("queue", "RQ"),
    "sqlalchemy": ("datastore", "SQLAlchemy"), "psycopg2": ("datastore", "PostgreSQL"),
    "psycopg": ("datastore", "PostgreSQL"), "pymongo": ("datastore", "MongoDB"), "motor": ("datastore", "MongoDB"),
    "sqlite3": ("datastore", "SQLite"), "mysql": ("datastore", "MySQL"), "pymysql": ("datastore", "MySQL"),
    "django.db": ("datastore", "Django ORM"), "elasticsearch": ("datastore", "Elasticsearch"),
    "memcache": ("cache", "Memcached"), "pymemcache": ("cache", "Memcached"),
    # JS
    "axios": ("http_client", "axios"), "node-fetch": ("http_client", "fetch"), "@aws-sdk": ("external", "AWS SDK"),
    "aws-sdk": ("external", "AWS SDK"), "nodemailer": ("external", "SMTP"), "@sendgrid/mail": ("external", "SendGrid"),
    "ioredis": ("cache_or_queue", "Redis"), "bull": ("queue", "Bull"), "bullmq": ("queue", "BullMQ"),
    "kafkajs": ("queue", "Kafka"), "amqplib": ("queue", "RabbitMQ"), "pg": ("datastore", "PostgreSQL"),
    "mysql2": ("datastore", "MySQL"), "mongoose": ("datastore", "MongoDB"), "mongodb": ("datastore", "MongoDB"),
    "@prisma/client": ("datastore", "Prisma"), "prisma": ("datastore", "Prisma"), "typeorm": ("datastore", "TypeORM"),
    "sequelize": ("datastore", "Sequelize"), "knex": ("datastore", "Knex"), "drizzle-orm": ("datastore", "Drizzle"),
    "node-cron": ("cron", "node-cron"), "@supabase/supabase-js": ("external", "Supabase"),
    "firebase": ("external", "Firebase"), "@slack/web-api": ("external", "Slack"),
}
SQL_RE = re.compile(r"\b(SELECT\s.+?\sFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE)\s+(\"?[\w.]+\"?)?",
                    re.IGNORECASE | re.DOTALL)
URL_LIT_RE = re.compile(r"""["'`](https?://[^\s"'`]+)["'`]""")
FLAG_NAME_RE = re.compile(r"(ENABLE|FEATURE|FLAG|USE_|LEGACY|EXPERIMENT)", re.IGNORECASE)
COMMENTED_ROUTE_PY = re.compile(r"^\s*#\s*@\s*\w+\.(" + "|".join(HTTP_METHODS) + r")\s*\(\s*['\"]([^'\"]+)")
COMMENTED_ROUTE_JS = re.compile(r"^\s*//\s*(?:app|router|server)\.(get|post|put|patch|delete|all)\s*\(\s*['\"`]([^'\"`]+)")


class Inventory:
    def __init__(self, root: Path, display_root: str | None = None):
        self.root = root
        self.display_root = display_root or str(root)
        self.files: list[dict] = []
        self.manifests: list[dict] = []
        self.entrypoints: list[dict] = []
        self.symbols: dict[str, list[dict]] = defaultdict(list)
        self.imports: list[dict] = []
        self.calls: list[dict] = []
        self.datastores: list[dict] = []
        self.file_io: list[dict] = []
        self.env_vars: list[dict] = []
        self.externals: list[dict] = []
        self.queues: list[dict] = []
        self.caches: list[dict] = []
        self.http_clients: list[dict] = []
        self.dead_code: list[dict] = []
        self.flag_defaults: dict[str, object] = {}
        self.py_modules: dict[str, str] = {}  # dotted module -> rel path
        self.name_refs: Counter = Counter()  # identifiers referenced anywhere (for dead-code)

    # ------------------------------------------------------------------ helpers
    def ev(self, rel, line, **kw):
        return {"file": rel, "line": line, **kw}

    def add_sdk(self, rel, line, module):
        for key, (cat, label) in KNOWN_SDKS.items():
            if module == key or module.startswith(key + ".") or module.startswith(key + "/"):
                rec = self.ev(rel, line, module=module, sdk=label, category=cat)
                if cat in ("external", "http_client"):
                    self.externals.append(rec)
                elif cat == "datastore":
                    self.datastores.append({**rec, "kind": "client"})
                elif cat == "queue":
                    self.queues.append({**rec, "kind": "client"})
                elif cat == "cache":
                    self.caches.append({**rec, "kind": "client"})
                elif cat == "cache_or_queue":
                    self.caches.append({**rec, "kind": "client"})
                elif cat == "cron":
                    self.entrypoints.append({**rec, "kind": "cron", "detail": "scheduler library"})
                return

    # ------------------------------------------------------------------ run
    def run(self):
        files, skipped = walk_repo(self.root)
        self.skipped = skipped
        for rel, p in files:
            if rel.endswith(".py"):
                mod = rel[:-3].replace("/", ".")
                if mod.endswith(".__init__"):
                    mod = mod[: -len(".__init__")]
                self.py_modules[mod] = rel
        texts = {}
        for rel, p in files:
            text = read_text(p)
            texts[rel] = text
            lang = LANG_BY_EXT.get(p.suffix.lower(), "other")
            if p.name in ("Dockerfile", "Makefile", "Procfile", "crontab") or p.name.endswith(".Dockerfile"):
                lang = p.name.lower() if p.name != "crontab" else "crontab"
            self.files.append({"path": rel, "lang": lang, "lines": text.count("\n") + 1, "bytes": len(text.encode())})
            self.manifest(rel, p, text)
        # Pass 1: python flag defaults (needed by route analysis)
        for rel, text in texts.items():
            if rel.endswith(".py"):
                self.py_flags(rel, text)
        for f in self.files:
            rel, lang, text = f["path"], f["lang"], texts[f["path"]]
            try:
                if lang == "python":
                    self.python(rel, text)
                elif lang in JS_LANGS:
                    self.js(rel, text)
                elif lang in ("go", "java", "kotlin", "ruby", "php", "rust", "csharp", "scala"):
                    self.generic(rel, text, lang)
            except SyntaxError as exc:
                f["parse_error"] = f"{exc.msg} (line {exc.lineno})"
            self.common(rel, text, lang)
        self.find_dead_python()

    # ------------------------------------------------------------------ manifests
    def manifest(self, rel, p, text):
        name = p.name
        if name == "package.json":
            try:
                data = json.loads(text)
            except ValueError:
                return
            deps = sorted({**data.get("dependencies", {}), **data.get("devDependencies", {})})
            self.manifests.append({"file": rel, "type": "npm", "name": data.get("name"), "scripts": data.get("scripts", {}),
                                   "bin": data.get("bin"), "main": data.get("main"), "dependencies": deps})
            for dep in data.get("dependencies", {}):
                self.add_sdk(rel, 1, dep)
            if isinstance(data.get("bin"), dict):
                for cmd, target in data["bin"].items():
                    self.entrypoints.append(self.ev(rel, 1, kind="cli", name=cmd, target=target))
        elif name in ("pyproject.toml", "setup.cfg", "requirements.txt", "Pipfile", "setup.py"):
            deps = re.findall(r'^\s*"?([A-Za-z0-9_.\-]+)\s*(?:[<>=~!\[;"]|$)', text, re.M) if name == "requirements.txt" else \
                re.findall(r'"([A-Za-z0-9_.\-]+)(?:[<>=~!\[ ][^"]*)?"', text)
            self.manifests.append({"file": rel, "type": "python", "dependencies": sorted(set(deps))[:200]})
            for m in re.finditer(r"^\s*([\w-]+)\s*=\s*\"([\w.]+):(\w+)\"", text, re.M):
                if "[project.scripts]" in text or "console_scripts" in text:
                    line = text[: m.start()].count("\n") + 1
                    self.entrypoints.append(self.ev(rel, line, kind="cli", name=m.group(1), target=f"{m.group(2)}:{m.group(3)}"))
        elif name in ("go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json"):
            self.manifests.append({"file": rel, "type": name})
        elif name == "Dockerfile" or name.endswith(".Dockerfile"):
            cmd = re.findall(r"^\s*(CMD|ENTRYPOINT)\s+(.+)$", text, re.M)
            line = next((i + 1 for i, l in enumerate(text.splitlines()) if re.match(r"\s*(CMD|ENTRYPOINT)", l)), 1)
            self.manifests.append({"file": rel, "type": "docker", "from": re.findall(r"^\s*FROM\s+(\S+)", text, re.M),
                                   "cmd": [c[1] for c in cmd], "line": line})
        elif re.match(r"(docker-)?compose(\.[\w-]+)?\.ya?ml$", name):
            services = self._compose_services(text)
            self.manifests.append({"file": rel, "type": "compose", "services": services})
        elif rel.startswith(".github/workflows/") or name in (".gitlab-ci.yml", "Jenkinsfile", ".travis.yml") or rel.startswith(".circleci/"):
            self.manifests.append({"file": rel, "type": "ci"})
            for i, l in enumerate(text.splitlines(), 1):
                m = re.search(r"cron:\s*['\"]([^'\"]+)['\"]", l)
                if m:
                    self.entrypoints.append(self.ev(rel, i, kind="cron", schedule=m.group(1), detail="CI schedule"))
        elif name == "crontab" or rel.endswith(".cron") or "/cron.d/" in rel:
            for i, l in enumerate(text.splitlines(), 1):
                m = re.match(r"^\s*((?:[\d*/,\-]+\s+){4}[\d*/,\-A-Za-z]+|@\w+)\s+(.+)$", l)
                if m and not l.strip().startswith("#"):
                    self.entrypoints.append(self.ev(rel, i, kind="cron", schedule=m.group(1).strip(), command=m.group(2).strip()))
        elif name == "Procfile":
            for i, l in enumerate(text.splitlines(), 1):
                if ":" in l:
                    proc, cmd = l.split(":", 1)
                    self.entrypoints.append(self.ev(rel, i, kind="process", name=proc.strip(), command=cmd.strip()))
        elif name.endswith((".yaml", ".yml")) and "kind: CronJob" in text:
            m = re.search(r"schedule:\s*['\"]?([^'\"\n]+)", text)
            self.entrypoints.append(self.ev(rel, 1, kind="cron", schedule=m.group(1) if m else "?", detail="k8s CronJob"))

    @staticmethod
    def _compose_services(text):
        services, in_services, current = {}, False, None
        for i, line in enumerate(text.splitlines(), 1):
            if re.match(r"^services:\s*$", line):
                in_services = True
                continue
            if in_services and re.match(r"^\S", line):
                in_services = False
            if not in_services:
                continue
            m = re.match(r"^  ([\w.-]+):\s*$", line)
            if m:
                current = m.group(1)
                services[current] = {"line": i}
                continue
            m = re.match(r"^    (image|command|build|depends_on|ports):\s*(.*)$", line)
            if m and current:
                services[current][m.group(1)] = m.group(2).strip()
        return services

    # ------------------------------------------------------------------ python
    def py_flags(self, rel, text):
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                name = node.targets[0].id
                if not FLAG_NAME_RE.search(name):
                    continue
                val = node.value
                if isinstance(val, ast.Constant):
                    self.flag_defaults[name] = {"default": val.value, "file": rel, "line": node.lineno}
                elif isinstance(val, ast.Compare) and isinstance(val.left, ast.Call) and val.comparators:
                    call = val.left
                    default = call.args[1].value if len(call.args) > 1 and isinstance(call.args[1], ast.Constant) else None
                    expect = val.comparators[0].value if isinstance(val.comparators[0], ast.Constant) else None
                    if default is not None and expect is not None:
                        self.flag_defaults[name] = {"default": default == expect, "file": rel, "line": node.lineno,
                                                    "env": call.args[0].value if call.args and isinstance(call.args[0], ast.Constant) else None}

    def _resolve_py_module(self, rel, module, level):
        if level:
            base = rel.split("/")[:-level]
            module = ".".join(base + ([module] if module else []))
        cands = [module]
        parts = module.split(".")
        while len(parts) > 1:
            parts = parts[:-1]
            cands.append(".".join(parts))
        for c in cands:
            if c in self.py_modules:
                return self.py_modules[c], c
        return None, None

    def python(self, rel, text):
        tree = ast.parse(text, filename=rel)
        alias_to_target: dict[str, tuple[str, str | None]] = {}  # local name -> (file, symbol or None for module)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    target, _ = self._resolve_py_module(rel, a.name, 0)
                    self.imports.append(self.ev(rel, node.lineno, module=a.name, resolved=target))
                    if target:
                        alias_to_target[a.asname or a.name.split(".")[0]] = (target, None)
                    self.add_sdk(rel, node.lineno, a.name)
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                for a in node.names:
                    full = f"{mod}.{a.name}" if mod else a.name
                    target, matched = self._resolve_py_module(rel, full, node.level)
                    is_module = target is not None and matched and matched.endswith(a.name)
                    if target is None:
                        target, _ = self._resolve_py_module(rel, mod, node.level)
                    self.imports.append(self.ev(rel, node.lineno, module=("." * node.level) + full, resolved=target))
                    if target:
                        alias_to_target[a.asname or a.name] = (target, None if is_module else a.name)
                if not node.level:
                    self.add_sdk(rel, node.lineno, mod)
            elif isinstance(node, ast.Name):
                self.name_refs[node.id] += 1
            elif isinstance(node, ast.Attribute):
                self.name_refs[node.attr] += 1

        # symbols + routes + calls, tracking enclosing function and module-level `if FLAG:` guards
        def visit(body, scope, guard):
            for node in body:
                if isinstance(node, ast.If) and scope is None:
                    names = {n.id for n in ast.walk(node.test) if isinstance(n, ast.Name)}
                    flag = next((n for n in names if FLAG_NAME_RE.search(n)), None)
                    visit(node.body, scope, flag or guard)
                    if node.orelse:
                        visit(node.orelse, scope, guard)
                    if scope is None and isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name) \
                            and node.test.left.id == "__name__":
                        self.entrypoints.append(self.ev(rel, node.lineno, kind="main", detail='if __name__ == "__main__"'))
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    kind = "class" if isinstance(node, ast.ClassDef) else "function"
                    qual = f"{scope}.{node.name}" if scope else node.name
                    sym = {"name": qual, "kind": kind, "line": node.lineno, "end_line": getattr(node, "end_lineno", node.lineno)}
                    if node.decorator_list:
                        sym["decorators"] = [ast.unparse(d)[:120] for d in node.decorator_list]
                    self.symbols[rel].append(sym)
                    self.py_decorators(rel, node, guard)
                    if isinstance(node, ast.ClassDef):
                        self.py_model(rel, node)
                        visit(node.body, qual, guard)
                    else:
                        self.py_calls(rel, node, qual, alias_to_target)
                        visit(node.body, qual, guard)
        visit(tree.body, None, None)
        # module-level calls
        self.py_patterns(rel, tree)

    def py_decorators(self, rel, fn, guard):
        if isinstance(fn, ast.ClassDef):
            return
        for d in fn.decorator_list:
            call = d if isinstance(d, ast.Call) else None
            func = call.func if call else d
            if not isinstance(func, ast.Attribute):
                if isinstance(func, ast.Name) and func.id in ("shared_task", "task", "periodic_task"):
                    self.entrypoints.append(self.ev(rel, fn.lineno, kind="queue_consumer", symbol=fn.name, detail=f"@{func.id}"))
                continue
            attr = func.attr.lower()
            owner = ast.unparse(func.value)
            if attr in HTTP_METHODS and call and call.args and isinstance(call.args[0], ast.Constant):
                path = str(call.args[0].value)
                method = attr.upper() if attr not in ("route", "api_route") else "ANY"
                if attr == "route":
                    for kw in call.keywords:
                        if kw.arg == "methods" and isinstance(kw.value, (ast.List, ast.Tuple)):
                            method = ",".join(str(e.value) for e in kw.value.elts if isinstance(e, ast.Constant))
                kind = "webhook" if re.search(r"web-?hook|/hooks?/|callback", path, re.I) else "http_route"
                ep = self.ev(rel, fn.lineno, kind=kind, method=method, path=path, symbol=fn.name, router=owner)
                if guard:
                    info = self.flag_defaults.get(guard)
                    ep["guarded_by"] = guard
                    if info is not None:
                        ep["guard_default"] = info["default"]
                        ep["guard_evidence"] = {"file": info["file"], "line": info["line"]}
                        if info["default"] is False:
                            ep["status"] = "deactivated"
                self.entrypoints.append(ep)
            elif attr in ("command", "group") and owner in ("click", "app", "cli", "typer") or attr == "command":
                self.entrypoints.append(self.ev(rel, fn.lineno, kind="cli", symbol=fn.name, detail=f"@{owner}.{func.attr}"))
            elif attr in ("task", "shared_task", "periodic_task", "actor"):
                self.entrypoints.append(self.ev(rel, fn.lineno, kind="queue_consumer", symbol=fn.name, detail=f"@{owner}.{func.attr}"))
            elif attr in ("on_event", "listener", "listens_for", "subscribe", "on", "event", "receiver", "connect"):
                self.entrypoints.append(self.ev(rel, fn.lineno, kind="event_listener", symbol=fn.name, detail=f"@{owner}.{func.attr}"))
            elif attr in ("scheduled_job", "cron", "schedule", "every"):
                self.entrypoints.append(self.ev(rel, fn.lineno, kind="cron", symbol=fn.name, detail=f"@{owner}.{func.attr}"))

    def py_model(self, rel, cls):
        bases = [ast.unparse(b) for b in cls.bases]
        table = None
        for stmt in cls.body:
            if isinstance(stmt, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__tablename__" for t in stmt.targets):
                if isinstance(stmt.value, ast.Constant):
                    table = stmt.value.value
        if table or any(b in ("Base", "Model", "db.Model", "models.Model", "DeclarativeBase", "SQLModel", "Document") for b in bases):
            cols = [t.id for s in cls.body if isinstance(s, (ast.Assign, ast.AnnAssign))
                    for t in (s.targets if isinstance(s, ast.Assign) else [s.target]) if isinstance(t, ast.Name) and not t.id.startswith("__")]
            self.datastores.append(self.ev(rel, cls.lineno, kind="model", name=cls.name, table=table, columns=cols, bases=bases))

    def py_calls(self, rel, fn, qual, alias_to_target):
        seen = set()
        for node in ast.walk(fn):
            if not isinstance(node, ast.Call):
                continue
            f = node.func
            target = None
            if isinstance(f, ast.Name) and f.id in alias_to_target:
                file, sym = alias_to_target[f.id]
                target = {"file": file, "symbol": sym or f.id}
            elif isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id in alias_to_target:
                file, sym = alias_to_target[f.value.id]
                if sym is None:
                    target = {"file": file, "symbol": f.attr}
                else:
                    target = {"file": file, "symbol": f"{sym}.{f.attr}"}
            elif isinstance(f, ast.Name) and any(s["name"] == f.id for s in self.symbols.get(rel, [])):
                target = {"file": rel, "symbol": f.id}
            if target:
                key = (target["file"], target["symbol"], node.lineno)
                if key not in seen:
                    seen.add(key)
                    self.calls.append({"file": rel, "line": node.lineno, "caller": qual, "callee_file": target["file"],
                                       "callee": target["symbol"]})

    def py_patterns(self, rel, tree):
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                if isinstance(node, ast.Subscript) and ast.unparse(node.value) == "os.environ" and isinstance(node.slice, ast.Constant):
                    self.env_vars.append(self.ev(rel, node.lineno, name=node.slice.value, required=True))
                continue
            fname = ast.unparse(node.func)
            short = fname.split(".")[-1]
            arg0 = node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) else None
            if fname in ("os.getenv", "os.environ.get", "getenv", "environ.get") and isinstance(arg0, str):
                default = node.args[1].value if len(node.args) > 1 and isinstance(node.args[1], ast.Constant) else None
                self.env_vars.append(self.ev(rel, node.lineno, name=arg0, default=default))
            elif fname in ("open", "io.open", "Path.open") or short in ("write_text", "read_text", "write_bytes", "read_bytes"):
                mode = "r"
                if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                    mode = str(node.args[1].value)
                for kw in node.keywords:
                    if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                        mode = str(kw.value.value)
                if short.startswith("write"):
                    mode = "w"
                self.file_io.append(self.ev(rel, node.lineno, op="write" if any(c in mode for c in "wax+") else "read",
                                            target=ast.unparse(node.args[0])[:120] if node.args else "?"))
            elif short in ("lpush", "rpush", "publish", "send_task", "delay", "apply_async", "basic_publish", "produce", "xadd") or \
                    short == "send_message" and re.search(r"(sqs|queue|producer|channel|bus|topic)", fname, re.I):
                self.queues.append(self.ev(rel, node.lineno, op="produce", call=fname, target=ast.unparse(node.args[0])[:80] if node.args else None))
            elif short in ("brpop", "blpop", "rpop", "lpop", "basic_consume", "subscribe", "poll", "receive_message", "xread", "consume"):
                self.queues.append(self.ev(rel, node.lineno, op="consume", call=fname, target=ast.unparse(node.args[0])[:80] if node.args else None))
            elif short in ("setex", "set", "get", "hget", "hset", "expire", "delete") and re.search(r"(redis|cache|_client|memcache)", fname, re.I):
                self.caches.append(self.ev(rel, node.lineno, op=short, call=fname))
            elif short in ("query", "execute", "add", "commit", "get", "filter_by", "fetchall", "insert_one", "find", "find_one", "update_one", "aggregate") \
                    and re.search(r"(session|conn|cursor|db|engine|collection)", fname, re.I):
                self.datastores.append(self.ev(rel, node.lineno, kind="query", call=fname, detail=ast.unparse(node)[:140]))
            elif short in ("add_job", "every") or fname.startswith("schedule."):
                self.entrypoints.append(self.ev(rel, node.lineno, kind="cron", detail=ast.unparse(node)[:120]))
            elif fname in ("argparse.ArgumentParser", "ArgumentParser"):
                self.entrypoints.append(self.ev(rel, node.lineno, kind="cli", detail="argparse"))
            elif short in ("Popen", "run", "call", "check_output", "system") and fname.split(".")[0] in ("subprocess", "os"):
                self.externals.append(self.ev(rel, node.lineno, category="process", sdk="subprocess", module=fname))
            # External SDK calls such as stripe.PaymentIntent.create(...)
            root = fname.split(".")[0]
            if root in KNOWN_SDKS and KNOWN_SDKS[root][0] in ("external", "http_client") and "." in fname:
                self.externals.append(self.ev(rel, node.lineno, category="sdk_call", sdk=KNOWN_SDKS[root][1], module=fname))

    def find_dead_python(self):
        called = {(c["callee_file"], c["callee"].split(".")[-1]) for c in self.calls}
        for rel, syms in self.symbols.items():
            if not rel.endswith(".py"):
                continue
            for s in syms:
                name = s["name"].split(".")[-1]
                if "." in s["name"] or s["kind"] != "function" or name.startswith("_") or s.get("decorators") or name == "main":
                    continue
                if (rel, name) in called:
                    continue
                if self.name_refs.get(name, 0) == 0:
                    self.dead_code.append(self.ev(rel, s["line"], symbol=s["name"], reason="no inbound references"))
        for ep in self.entrypoints:
            if ep.get("status") == "deactivated":
                self.dead_code.append(self.ev(ep["file"], ep["line"], symbol=ep.get("symbol"),
                                              reason=f"route guarded by {ep['guarded_by']} (default off)"))
        # Code reachable only from deactivated routes
        deact = {(e["file"], e.get("symbol")) for e in self.entrypoints if e.get("status") == "deactivated"}
        live_callers = defaultdict(set)
        for c in self.calls:
            live_callers[(c["callee_file"], c["callee"].split(".")[-1])].add((c["file"], c["caller"]))
        for key, callers in live_callers.items():
            if callers and callers <= deact:
                rel, name = key
                line = next((s["line"] for s in self.symbols.get(rel, []) if s["name"] == name), 1)
                self.dead_code.append(self.ev(rel, line, symbol=name, reason="only called from deactivated code"))

    # ------------------------------------------------------------------ JS / TS
    JS_IMPORT = re.compile(r"""(?:import\s+(?:[\w*{}\s,]+\s+from\s+)?|require\(\s*|import\(\s*)['"]([^'"]+)['"]""")
    JS_ROUTE = re.compile(r"""\b(?:app|router|server|api|fastify|routes?)\s*\.\s*(get|post|put|patch|delete|all|use)\s*\(\s*['"`]([^'"`]+)['"`]""")
    JS_FUNC = re.compile(r"""^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)|^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)""", re.M)
    JS_FETCH = re.compile(r"""\b(fetch|axios(?:\.(get|post|put|patch|delete))?|ky|got|\$http\.\w+)\s*\(\s*(['"`])(.+?)\3""")
    JS_ENV = re.compile(r"""\b(?:process\.env|import\.meta\.env)\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]""")

    def _resolve_js(self, rel, spec):
        if not spec.startswith((".", "/", "@/", "~/")):
            return None
        base = Path(rel).parent
        if spec.startswith(("@/", "~/")):
            spec = "src/" + spec[2:]
            base = Path("")
        cand = (base / spec).as_posix()
        parts = []
        for seg in cand.split("/"):
            if seg == "..":
                if parts:
                    parts.pop()
            elif seg not in (".", ""):
                parts.append(seg)
        cand = "/".join(parts)
        known = self._known_files
        for suffix in ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", "/index.ts", "/index.tsx", "/index.js"):
            if cand + suffix in known:
                return cand + suffix
        return None

    @property
    def _known_files(self):
        if not hasattr(self, "_kf"):
            self._kf = {f["path"] for f in self.files}
        return self._kf

    def js(self, rel, text):
        lines = text.splitlines()
        line_of = _line_index(text)
        for m in self.JS_IMPORT.finditer(text):
            spec = m.group(1)
            ln = line_of(m.start())
            self.imports.append(self.ev(rel, ln, module=spec, resolved=self._resolve_js(rel, spec)))
            self.add_sdk(rel, ln, spec)
        for m in self.JS_FUNC.finditer(text):
            name = m.group(1) or m.group(2) or m.group(3)
            self.symbols[rel].append({"name": name, "kind": "class" if m.group(3) else "function", "line": line_of(m.start())})
        self.js_calls(rel, text, line_of)
        for m in self.JS_ROUTE.finditer(text):
            method, path = m.group(1).upper(), m.group(2)
            line_start = text.rfind("\n", 0, m.start()) + 1
            if method == "USE" or re.match(r"\s*(//|\*|/\*)", text[line_start:m.start()]):
                continue  # commented-out routes are reported as dead code instead
            kind = "webhook" if re.search(r"web-?hook|/hooks?/|callback", path, re.I) else "http_route"
            self.entrypoints.append(self.ev(rel, line_of(m.start()), kind=kind, method=method, path=path))
        for m in self.JS_FETCH.finditer(text):
            ln = line_of(m.start())
            window = "\n".join(lines[ln - 1: ln + 4])
            meth = m.group(2).upper() if m.group(2) else None
            mm = re.search(r"method:\s*['\"](\w+)['\"]", window)
            method = meth or (mm.group(1).upper() if mm else "GET")
            enclosing = self._enclosing(rel, ln)
            self.http_clients.append(self.ev(rel, ln, client=m.group(1), method=method, url=m.group(4), function=enclosing))
        for m in self.JS_ENV.finditer(text):
            self.env_vars.append(self.ev(rel, line_of(m.start()), name=m.group(1) or m.group(2)))
        for m in re.finditer(r"""\bcron\.schedule\(\s*['"]([^'"]+)['"]""", text):
            self.entrypoints.append(self.ev(rel, line_of(m.start()), kind="cron", schedule=m.group(1)))
        for m in re.finditer(r"""\.(process|subscribe|consume)\(\s*(?:\{[^}]*topic:\s*)?['"]([\w:.\-]+)['"]""", text):
            self.entrypoints.append(self.ev(rel, line_of(m.start()), kind="queue_consumer", target=m.group(2)))
        for m in re.finditer(r"""\b(\w+)\.on\(\s*['"]([\w:.\-]+)['"]""", text):
            if m.group(1) not in ("window", "document", "el", "element", "process"):
                self.entrypoints.append(self.ev(rel, line_of(m.start()), kind="event_listener", emitter=m.group(1), event=m.group(2)))
        for m in re.finditer(r"""\.(add|publish|send|emit)\(\s*['"]([\w:.\-]+)['"]""", text):
            self.queues.append(self.ev(rel, line_of(m.start()), op="produce", call=m.group(1), target=m.group(2)))
        # File-system routing (Next.js / Remix / SvelteKit) and UI pages
        if re.search(r"(^|/)(pages|app)/api/", rel) or re.search(r"(^|/)app/.*route\.(t|j)sx?$", rel):
            for m in re.finditer(r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b", text):
                self.entrypoints.append(self.ev(rel, line_of(m.start()), kind="http_route", method=m.group(1), path="/" + rel))
        elif re.search(r"(^|/)(pages|views|screens|routes)/", rel) and rel.endswith((".tsx", ".jsx", ".vue", ".svelte")):
            comp = next((s["name"] for s in self.symbols[rel] if s["name"][:1].isupper()), Path(rel).stem)
            self.entrypoints.append(self.ev(rel, 1, kind="ui_page", symbol=comp))
        for i, l in enumerate(lines, 1):
            m = COMMENTED_ROUTE_JS.match(l)
            if m:
                self.dead_code.append(self.ev(rel, i, symbol=f"{m.group(1).upper()} {m.group(2)}", reason="commented-out route"))

    JS_NAMED = re.compile(r"""import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+))?\s*from\s*['"]([^'"]+)['"]""")
    JS_REQUIRE = re.compile(r"""(?:const|let|var)\s+(?:\{([^}]*)\}|(\w+))\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)""")

    def js_calls(self, rel, text, line_of):
        """Call edges to functions imported from other files in the repo (regex level)."""
        local: dict[str, tuple[str, str | None]] = {}  # name -> (file, symbol or None for namespace)
        for m in self.JS_NAMED.finditer(text):
            target = self._resolve_js(rel, m.group(4))
            if not target:
                continue
            if m.group(1):
                local[m.group(1)] = (target, "default")
            for part in (m.group(2) or "").split(","):
                bits = part.strip().split(" as ")
                if bits[0].strip() and bits[0].strip() != "type":
                    local[bits[-1].strip()] = (target, bits[0].strip())
            if m.group(3):
                local[m.group(3)] = (target, None)
        for m in self.JS_REQUIRE.finditer(text):
            target = self._resolve_js(rel, m.group(3))
            if not target:
                continue
            if m.group(2):
                local[m.group(2)] = (target, None)
            for part in (m.group(1) or "").split(","):
                bits = [b.strip() for b in part.split(":")]
                if bits[0]:
                    local[bits[-1]] = (target, bits[0])
        if not local:
            return
        names = "|".join(re.escape(k) for k in sorted(local, key=len, reverse=True))
        seen = set()
        for m in re.finditer(rf"(?<![\w.])({names})(?:\.(\w+))?\s*\(", text):
            ln = line_of(m.start())
            file, sym = local[m.group(1)]
            callee = sym if sym and sym != "default" else (m.group(2) or m.group(1))
            caller = self._enclosing(rel, ln) or "<module>"
            key = (caller, file, callee, ln)
            if key in seen:
                continue
            seen.add(key)
            self.calls.append({"file": rel, "line": ln, "caller": caller, "callee_file": file, "callee": callee, "lang": "js"})

    def _enclosing(self, rel, line):
        best = None
        for s in self.symbols.get(rel, []):
            if s["line"] <= line and (best is None or s["line"] > best["line"]):
                best = s
        return best["name"] if best else None

    # ------------------------------------------------------------------ fallback
    GENERIC_ROUTES = [
        re.compile(r"""\b(?:http\.)?HandleFunc\(\s*"([^"]+)\""""),
        re.compile(r"""\.\s*(GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)\""""),
        re.compile(r"""@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*)?"([^"]+)\""""),
        re.compile(r"""^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]""", re.M),
        re.compile(r"""Route::(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]"""),
    ]
    GENERIC_IMPORT = re.compile(r"""^\s*(?:import|use|require|require_relative|include)\s+\(?\s*["']?([\w./\\:\-]+)""", re.M)

    def generic(self, rel, text, lang):
        line_of = _line_index(text)
        for m in self.GENERIC_IMPORT.finditer(text):
            self.imports.append(self.ev(rel, line_of(m.start()), module=m.group(1), resolved=None, fallback=True))
        for rx in self.GENERIC_ROUTES:
            for m in rx.finditer(text):
                g = m.groups()
                method, path = (g[0].upper(), g[1]) if len(g) == 2 else ("ANY", g[0])
                self.entrypoints.append(self.ev(rel, line_of(m.start()), kind="http_route", method=method, path=path, fallback=True))
        if re.search(r"\bfunc\s+main\s*\(", text) or re.search(r"static\s+void\s+main\s*\(", text) or re.search(r"\bfn\s+main\s*\(", text):
            m = re.search(r"\bfunc\s+main\s*\(|static\s+void\s+main\s*\(|\bfn\s+main\s*\(", text)
            self.entrypoints.append(self.ev(rel, line_of(m.start()), kind="main", fallback=True))

    # ------------------------------------------------------------------ language-neutral
    def common(self, rel, text, lang):
        if lang in ("markdown", "json", "yaml", "toml", "html", "css"):
            return
        for i, l in enumerate(text.splitlines(), 1):
            if lang == "python":
                m = COMMENTED_ROUTE_PY.match(l)
                if m:
                    self.dead_code.append(self.ev(rel, i, symbol=f"{m.group(1).upper()} {m.group(2)}", reason="commented-out route"))
            for m in URL_LIT_RE.finditer(l):
                url = m.group(1)
                if not re.search(r"(localhost|127\.0\.0\.1|example\.(com|org)|schemas?\.|w3\.org|json-schema)", url):
                    self.externals.append(self.ev(rel, i, category="url", url=url[:200]))
            for m in SQL_RE.finditer(l):
                self.datastores.append(self.ev(rel, i, kind="sql", detail=l.strip()[:160]))
        if lang == "shell" or rel.endswith(".env.example") or rel.endswith(".env.sample"):
            for i, l in enumerate(text.splitlines(), 1):
                m = re.match(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)=", l)
                if m:
                    self.env_vars.append(self.ev(rel, i, name=m.group(1), declared=True))

    # ------------------------------------------------------------------ output
    def to_json(self):
        langs: dict[str, dict] = {}
        for f in self.files:
            d = langs.setdefault(f["lang"], {"files": 0, "lines": 0})
            d["files"] += 1
            d["lines"] += f["lines"]
        env = {}
        for e in self.env_vars:
            env.setdefault(e["name"], []).append({k: v for k, v in e.items() if k != "name"})
        return {
            "tool": "flowmap-inventory/0.1",
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "root": self.display_root,
            "stats": {"files": len(self.files), "lines": sum(f["lines"] for f in self.files),
                      "languages": dict(sorted(langs.items(), key=lambda kv: -kv[1]["lines"])), "skipped": self.skipped},
            "tree": [{k: f[k] for k in ("path", "lang", "lines") if k in f} | ({"parse_error": f["parse_error"]} if "parse_error" in f else {})
                     for f in self.files],
            "manifests": self.manifests,
            "entrypoints": self.entrypoints,
            "symbols": dict(self.symbols),
            "imports": self.imports,
            "calls": self.calls,
            "datastores": self.datastores,
            "file_io": self.file_io,
            "env_vars": env,
            "externals": _dedupe(self.externals),
            "queues": self.queues,
            "caches": self.caches,
            "http_clients": self.http_clients,
            "dead_code": _dedupe(self.dead_code),
            "feature_flags": self.flag_defaults,
        }


def _line_index(text):
    import bisect
    starts = [0] + [i + 1 for i, c in enumerate(text) if c == "\n"]
    return lambda off: bisect.bisect_right(starts, off)


def _dedupe(items):
    seen, out = set(), []
    for it in items:
        key = json.dumps(it, sort_keys=True, default=str)
        if key not in seen:
            seen.add(key)
            out.append(it)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=Path)
    ap.add_argument("-o", "--out", type=Path, help="output path (default: stdout)")
    args = ap.parse_args()
    if not args.root.is_dir():
        raise SystemExit(f"not a directory: {args.root}")
    inv = Inventory(args.root.resolve(), str(args.root))
    inv.run()
    dump_json(inv.to_json(), args.out)
    if args.out:
        s = inv.to_json()["stats"]
        print(f"inventory: {s['files']} files, {s['lines']} lines, {len(inv.entrypoints)} entry points -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
