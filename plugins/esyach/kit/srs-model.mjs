// The SRS model behind an SRS page: load srs.json (and the extraction and screenshots it names), check it, and compute coverage.
// One implementation of coverage, used by the renderer; tools/coverage.mjs prints the same report for the terminal.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

export const STATES = ["default", "empty", "filled", "error", "success", "modal", "loading"];
export const HOTSPOT_KINDS = ["button", "link", "tab", "menu", "field", "toggle", "checkbox", "image", "other"];
export const FINDING_TYPES = ["contradiction", "missing_state", "ambiguity", "note"];
export const LEVELS = ["low", "med", "high"];
export const JOURNEY_KINDS = ["happy", "alternate", "failure"];
const NAVIGATES = new Set(["button", "link", "tab", "menu"]);
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

const readJson = (path, what) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Error(`${what} ${path}: ${e.code === "ENOENT" ? "not found" : e.message}`); }
};

/** Width and height from a PNG, JPEG, or WebP header, so a screen keeps its shape without decoding the image. */
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L") { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}

const boxOk = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === "number" && v >= 0 && v <= 1)
  && b[2] > 0 && b[3] > 0 && b[0] + b[2] <= 1.001 && b[1] + b[3] <= 1.001;

/**
 * Loads `<base>/<file>` and everything it names. Returns { model, errors, warnings }; errors name the JSON path.
 * Requirements come from the extraction (`extraction`), so the page never carries a requirement the SRS does not.
 */
export function loadModel(file, base) {
  const errors = [], warnings = [];
  const path = resolve(base, file);
  const dir = dirname(path);
  const m = readJson(path, "SRS model");
  if (m.schema !== "esyach-srs/1") errors.push(`${file}: "schema" must be "esyach-srs/1"`);
  const ext = m.extraction ? readJson(resolve(dir, m.extraction), "SRS extraction") : null;
  if (!ext) errors.push(`${file}: "extraction" must name the srs_text.json that tools/extract_srs.py wrote`);
  const reqs = new Map((ext?.requirements ?? []).map((r) => [r.id, { ...r }]));
  for (const [id, ui] of Object.entries(m.ui_overrides ?? {})) {
    if (!reqs.has(id)) errors.push(`${file} ui_overrides: ${id} is not in the extraction`);
    else reqs.get(id).ui = !!ui;
  }
  if (!reqs.size) errors.push(`${file}: the extraction has no requirements; check the SRS text, or number its "shall" statements`);
  const manifest = m.manifest && existsSync(resolve(dir, m.manifest)) ? readJson(resolve(dir, m.manifest), "screens manifest") : null;
  const sizes = new Map((manifest?.screens ?? []).filter((s) => s.width).map((s) => [s.file, [s.width, s.height]]));

  const actors = new Map((m.actors ?? []).map((a) => [a.id, a]));
  const screens = new Map();
  const req = (id, where) => { if (!reqs.has(id)) errors.push(`${where}: requirement "${id}" is not in the SRS extraction`); };
  const lvl = (v, where, name) => { if (v !== undefined && !LEVELS.includes(v)) errors.push(`${where}: ${name} "${v}" is not one of ${LEVELS.join(", ")}`); };
  const assets = new Map(); // image file -> { key, uri, size }

  // An image is embedded once; every screen, step, and prototype view points at it through one CSS variable.
  const image = (name, where) => {
    if (!name) { errors.push(`${where}: "image" is missing`); return null; }
    if (assets.has(name)) return assets.get(name);
    const web = m.images ? resolve(dir, m.images, name.replace(/\.[^.]+$/, ".webp")) : null;
    const orig = resolve(dir, m.screens_dir ?? ".", name);
    const pick = web && existsSync(web) ? web : orig;
    if (!existsSync(pick)) { errors.push(`${where}: image not found: ${orig}`); return null; }
    const buf = readFileSync(pick);
    const mime = MIME[extname(pick).toLowerCase()];
    if (!mime) { errors.push(`${where}: ${basename(pick)} is not a PNG, JPEG, or WebP`); return null; }
    const size = sizes.get(name) ?? (existsSync(orig) ? imageSize(readFileSync(orig)) : null) ?? imageSize(buf);
    if (!size) { errors.push(`${where}: cannot read the size of ${name}`); return null; }
    const a = { key: `i${assets.size}`, uri: `data:${mime};base64,${buf.toString("base64")}`, size, bytes: buf.length };
    assets.set(name, a);
    return a;
  };

  const hotspots = (list, where) => {
    const seen = new Set();
    for (const h of list ?? []) {
      const hw = `${where} hotspot ${h.id}`;
      if (!h.id) errors.push(`${where}: a hotspot has no "id"`);
      if (seen.has(h.id)) errors.push(`${hw}: duplicate id`);
      seen.add(h.id);
      if (!HOTSPOT_KINDS.includes(h.kind)) errors.push(`${hw}: kind "${h.kind}" is not one of ${HOTSPOT_KINDS.join(", ")}`);
      if (!boxOk(h.box)) errors.push(`${hw}: box must be [x, y, w, h] in 0-1 and inside the image, got ${JSON.stringify(h.box)}`);
    }
  };

  for (const s of m.screens ?? []) {
    const where = `${file} screen ${s.id}`;
    if (!s.id) { errors.push(`${file}: a screen has no "id"`); continue; }
    if (screens.has(s.id)) errors.push(`${where}: duplicate id`);
    if (s.state && !STATES.includes(s.state)) errors.push(`${where}: state "${s.state}" is not one of ${STATES.join(", ")}`);
    for (const a of s.actors ?? []) if (actors.size && !actors.has(a)) errors.push(`${where}: unknown actor "${a}"`);
    for (const r of s.reqs ?? []) {
      req(r.id, where);
      if (!r.reason) errors.push(`${where}: requirement ${r.id} needs a "reason": what on the screen satisfies it`);
      lvl(r.confidence, where, `requirement ${r.id} confidence`);
    }
    s.asset = image(s.image, where);
    hotspots(s.hotspots, where);
    const vids = new Set();
    for (const v of s.variants ?? []) {
      const vw = `${where} variant ${v.id}`;
      if (!v.id || vids.has(v.id)) errors.push(`${vw}: missing or duplicate id`);
      vids.add(v.id);
      if (v.state && !STATES.includes(v.state)) errors.push(`${vw}: state "${v.state}" is not one of ${STATES.join(", ")}`);
      v.asset = image(v.image, vw);
      hotspots(v.hotspots, vw);
    }
    screens.set(s.id, s);
  }
  if (!screens.size && (m.screens ?? []).length === 0) warnings.push(`${file}: no screens; the page can explain the SRS, but coverage counts every UI requirement as without a screen`);

  const hotspotOf = (screen, variant, id) => {
    const s = screens.get(screen);
    if (!s) return null;
    const v = variant ? (s.variants ?? []).find((x) => x.id === variant) : null;
    return (v?.hotspots ?? []).find((h) => h.id === id) ?? (s.hotspots ?? []).find((h) => h.id === id) ?? null;
  };
  const variantOk = (screen, variant, where) => {
    if (variant && !(screens.get(screen)?.variants ?? []).some((v) => v.id === variant)) errors.push(`${where}: variant "${variant}" does not exist on ${screen}`);
  };

  (m.links ?? []).forEach((l, i) => {
    const where = `${file} links[${i}] ${l.from}→${l.to}`;
    if (!screens.has(l.from)) errors.push(`${where}: unknown screen "${l.from}"`);
    if (!screens.has(l.to)) errors.push(`${where}: unknown screen "${l.to}"`);
    if (l.hotspot && screens.has(l.from) && !hotspotOf(l.from, l.variant, l.hotspot)) errors.push(`${where}: hotspot "${l.hotspot}" does not exist on ${l.from}${l.variant ? ` (${l.variant})` : ""}`);
    variantOk(l.from, l.variant, where);
    variantOk(l.to, l.to_variant, where);
    for (const r of l.reqs ?? []) req(r, where);
    if (l.inferred && !l.reason) errors.push(`${where}: an inferred link needs a "reason"`);
    lvl(l.confidence, where, "confidence");
  });

  for (const j of m.journeys ?? []) {
    const where = `${file} journey ${j.id}`;
    if (!j.id || !(j.steps ?? []).length) errors.push(`${where}: needs an "id" and at least one step`);
    if (j.kind && !JOURNEY_KINDS.includes(j.kind)) errors.push(`${where}: kind "${j.kind}" is not one of ${JOURNEY_KINDS.join(", ")}`);
    if (j.actor && actors.size && !actors.has(j.actor)) errors.push(`${where}: unknown actor "${j.actor}"`);
    (j.steps ?? []).forEach((s, k) => {
      const sw = `${where} step ${k + 1}`;
      if (!screens.has(s.screen)) { errors.push(`${sw}: unknown screen "${s.screen}"`); return; }
      variantOk(s.screen, s.variant, sw);
      if (s.hotspot && !hotspotOf(s.screen, s.variant, s.hotspot)) errors.push(`${sw}: hotspot "${s.hotspot}" does not exist on ${s.screen}${s.variant ? ` (${s.variant})` : ""}`);
      if (!s.text) errors.push(`${sw}: "text" is missing: one sentence saying what the user does here`);
      if (s.req) req(s.req, sw);
    });
  }

  for (const f of m.findings ?? []) {
    const where = `${file} finding ${f.id}`;
    if (!f.id || !f.text) errors.push(`${where}: needs "id" and "text"`);
    if (!FINDING_TYPES.includes(f.type)) errors.push(`${where}: type "${f.type}" is not one of ${FINDING_TYPES.join(", ")}`);
    lvl(f.severity, where, "severity");
    if (f.req) req(f.req, where);
    if (f.screen && !screens.has(f.screen)) errors.push(`${where}: unknown screen "${f.screen}"`);
    if (f.screen) variantOk(f.screen, f.variant, where);
    if (f.hotspot && f.screen && !hotspotOf(f.screen, f.variant, f.hotspot)) errors.push(`${where}: hotspot "${f.hotspot}" does not exist on ${f.screen}`);
    if (f.type === "contradiction" && (!f.srs_says || !f.screen_shows)) errors.push(`${where}: a contradiction needs "srs_says" and "screen_shows"`);
  }
  for (const mod of m.modules ?? []) for (const r of mod.reqs ?? []) req(r, `${file} module ${mod.id}`);

  const model = { file, dir, raw: m, project: m.project ?? {}, reqs, actors, screens, links: m.links ?? [], journeys: m.journeys ?? [], findings: m.findings ?? [], modules: m.modules ?? [], assets, pii: ext?.pii ?? [], auto: [...reqs.values()].some((r) => r.auto), hotspotOf };
  if (model.pii.length) warnings.push(`the SRS holds ${model.pii.length} value(s) that look like real personal data (${model.pii.slice(0, 3).map((p) => `${p.kind} at ${p.loc}`).join(", ")}); tell the user before sharing the page`);
  if (!errors.length) model.coverage = coverage(model);
  return { model, errors, warnings };
}

/** Structural gaps, computed from the model alone: never written by hand. */
export function coverage(model) {
  const { reqs, screens, links } = model;
  const nav = links.filter((l) => screens.has(l.from) && screens.has(l.to));
  const covered = new Set();
  for (const s of screens.values()) for (const r of s.reqs ?? []) covered.add(r.id);
  for (const l of nav) for (const r of l.reqs ?? []) covered.add(r);
  const ui = [...reqs.values()].filter((r) => r.ui !== false);
  const out = new Map([...screens.keys()].map((k) => [k, []]));
  for (const l of nav) if (l.from !== l.to) out.get(l.from).push(l.to);
  let entries = [...screens.values()].filter((s) => s.entry).map((s) => s.id);
  if (!entries.length) { const inbound = new Set(nav.filter((l) => l.from !== l.to).map((l) => l.to)); entries = [...screens.keys()].filter((k) => !inbound.has(k)); }
  const seen = new Set(entries), queue = [...entries];
  while (queue.length) for (const t of out.get(queue.shift())) if (!seen.has(t)) { seen.add(t); queue.push(t); }
  const linked = new Set(nav.map((l) => `${l.from}|${l.hotspot}`));
  const deadControls = [];
  for (const s of screens.values()) {
    const all = [...(s.hotspots ?? []).map((h) => [h, null]), ...(s.variants ?? []).flatMap((v) => (v.hotspots ?? []).map((h) => [h, v.id]))];
    const done = new Set();
    for (const [h, variant] of all) {
      if (done.has(h.id)) continue;
      done.add(h.id);
      if (NAVIGATES.has(h.kind) && !h.in_place && !linked.has(`${s.id}|${h.id}`)) deadControls.push({ screen: s.id, variant, hotspot: h.id, label: h.label ?? h.id });
    }
  }
  const total = ui.length, coveredUi = ui.filter((r) => covered.has(r.id)).map((r) => r.id);
  return {
    total, covered: coveredUi, percent: total ? Math.round((coveredUi.length / total) * 100) : 0,
    withoutScreen: ui.filter((r) => !covered.has(r.id)).map((r) => r.id),
    nonUi: [...reqs.values()].filter((r) => r.ui === false).map((r) => r.id),
    screensWithoutReq: [...screens.values()].filter((s) => !(s.reqs ?? []).length).map((s) => s.id),
    deadEnds: [...screens.keys()].filter((k) => !out.get(k).length),
    unreachable: [...screens.keys()].filter((k) => !seen.has(k)),
    deadControls, inferred: nav.filter((l) => l.inferred), entries,
    // the same inferred control on many screens (a header link) is one question, not one per screen
    inferredGroups: [...nav.filter((l) => l.inferred).reduce((g, l) => { const k = `${l.label ?? l.hotspot}|${l.to}|${l.reason}`; g.set(k, [...(g.get(k) ?? []), l]); return g; }, new Map()).values()],
    findings: model.findings,
  };
}

/** Which screens satisfy a requirement, through a screen's own link or a transition that carries it. */
export function screensFor(model, id, { own = false } = {}) {
  const out = new Set();
  for (const s of model.screens.values()) if ((s.reqs ?? []).some((r) => r.id === id)) out.add(s.id);
  // a transition counts for the screen that holds its control, not the one it lands on
  if (!own) for (const l of model.links) if ((l.reqs ?? []).includes(id)) out.add(l.from);
  return [...out];
}

