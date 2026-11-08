// SRS tags: the agent names a requirement, screen, or journey; the renderer draws it from srs.json (kit/srs-model.mjs).
//   <ve-coverage>                      KPI strip: requirements with a screen, contradictions, gaps, questions; computed
//   <ve-modules>                       one card per module: its requirements by status and the screens that carry them
//   <ve-trace [module=] [kind=]>       requirement → screens table with a status chip per row
//   <ve-gaps [only=findings|computed]> small multiples: contradictions, missing states, requirements with no screen, dead controls…
//   <ve-screen id= [variant=] [hl=]>   a screenshot with its numbered controls and where each one leads
//   <ve-journey id=>                   inside <figure class="ve-steps">: one screen per step, the control to press outlined
//   <ve-proto [start=]>                the clickable prototype: every control goes where it leads
//   <ve-req id=>                       an inline requirement ID that lights its rows and screens
import { esc } from "./html.mjs";
import { TAGS } from "./tags.mjs";
import { screensFor } from "./srs-model.mjs";

export const SRS_TAG_NAMES = ["ve-coverage", "ve-modules", "ve-trace", "ve-gaps", "ve-screen", "ve-journey", "ve-proto", "ve-req"];
const key = (s) => String(s).replace(/[^\w.-]+/g, "_");
export const rRef = (id) => `r-${key(id)}`;
export const sRef = (id) => `s-${key(id)}`;
const pct = (v) => `${+(v * 100).toFixed(2)}%`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function need(m, n, ctx) {
  if (!m) { ctx.errors.push(`${ctx.where(n)}: SRS tags need the model; add data-srs="srs.json" to <html>`); return false; }
  return true;
}

/** A screenshot at its own shape, its controls as boxes; `hl` outlines one control, `numbers` labels each one. */
export function shot(m, screen, { variant, hl, numbers = false, small = false, dead = new Set() } = {}) {
  const s = m.screens.get(screen);
  const v = variant ? (s.variants ?? []).find((x) => x.id === variant) : null;
  const a = (v ?? s).asset ?? s.asset;
  if (!a) return "";
  const hs = v?.hotspots ?? s.hotspots ?? [];
  const boxes = hs.map((h, i) => {
    const [x, y, w, hh] = h.box;
    const cls = ["srs-hs", h.id === hl ? "is-hl" : "", dead.has(h.id) ? "is-dead" : ""].filter(Boolean).join(" ");
    if (!numbers && h.id !== hl && !dead.has(h.id)) return "";
    return `<span class="${cls}" style="left:${pct(x)};top:${pct(y)};width:${pct(w)};height:${pct(hh)}">${numbers ? `<b>${i + 1}</b>` : ""}</span>`;
  }).join("");
  const label = `${s.label ?? s.id}${v ? ` (${v.label ?? v.id})` : ""}`;
  return `<div class="srs-shot${small ? " is-small" : ""}" role="img" aria-label="Screenshot: ${esc(label)}" style="--img: var(--srs-${a.key}); --ar: ${+(a.size[0] / a.size[1]).toFixed(4)}; aspect-ratio: ${a.size[0]} / ${a.size[1]}">${boxes}</div>`;
}

const reqChip = (m, id) => {
  const r = m.reqs.get(id);
  return `<span class="srs-id ve-ref" data-ref="${rRef(id)}" tabindex="0" title="${esc(r?.text ?? "")}">${esc(id)}</span>`;
};
const screenChip = (m, id) => `<span class="srs-sc ve-ref" data-ref="${sRef(id)}" tabindex="0">${esc(m.screens.get(id)?.label ?? id)}</span>`;

/** Status of a requirement: no UI, contradicted, on a screen, or without one. */
function status(m, id) {
  const r = m.reqs.get(id), c = m.coverage;
  if (m.findings.some((f) => f.type === "contradiction" && f.req === id)) return ["risk", "contradicted"];
  if (r?.ui === false) return ["mute", "no UI"];
  if (!m.screens.size) return ["mute", "no screens supplied"];
  if (c.withoutScreen.includes(id)) return ["risk", "no screen"];
  if (m.findings.some((f) => f.type === "missing_state" && f.req === id)) return ["warn", "state missing"];
  return ["ok", "on screen"];
}

function coverageTag(n, ctx) {
  const m = ctx.model;
  if (!need(m, n, ctx)) return "";
  const c = m.coverage;
  const contra = m.findings.filter((f) => f.type === "contradiction").length;
  const missing = m.findings.filter((f) => f.type === "missing_state").length;
  const unseen = m.screens.size ? c.withoutScreen.length : 0;
  const gaps = unseen + c.deadControls.length + c.unreachable.length + missing;
  const questions = m.findings.filter((f) => f.type === "ambiguity").length + c.inferredGroups.length;
  const waffle = TAGS["ve-waffle"]({ name: "ve-waffle", attrs: { value: String(c.percent), note: `${c.withoutScreen.length} without`, label: `${c.covered.length} of ${c.total} UI requirements appear on a screen` }, children: [] }, ctx);
  const parts = [[unseen, "no screen"], [c.deadControls.length, "leads nowhere"], [missing, "state missing"], [c.unreachable.length, "unreachable"]].filter(([v]) => v);
  const gapNote = parts.length ? parts.map(([v, w]) => `${v} ${w}`).join(" · ") : "none: computed from the screens";
  const kpi = (label, val, unit, pic, note) => `<div class="kpi"><span class="ve-label">${label}</span><span class="val"><span data-count="${val}">${val}</span>${unit ? `<span class="unit">${unit}</span>` : ""}</span>${pic}${note ? `<small class="srs-note">${note}</small>` : ""}</div>`;
  const first = m.screens.size ? kpi("UI requirements on a screen", c.percent, "%", waffle, `${c.covered.length} of ${c.total}${c.nonUi.length ? ` · ${c.nonUi.length} without UI not counted` : ""}`)
    : `<div class="kpi"><span class="ve-label">UI requirements</span><span class="val"><span data-count="${c.total}">${c.total}</span></span><small class="srs-note">no screenshots supplied, so coverage is not measured</small></div>`;
  return `<div class="kpis srs-kpis">${first}${
    kpi("Contradictions", contra, "", "", contra ? "the SRS and a screen disagree" : "none found")}${
    kpi("Gaps", gaps, "", "", gapNote)}${
    kpi("Open questions", questions, "", "", `${m.findings.filter((f) => f.type === "ambiguity").length} ambiguous · ${c.inferredGroups.length} inferred link${c.inferredGroups.length === 1 ? "" : "s"}`)}</div>`;
}

function modulesTag(n, ctx) {
  const m = ctx.model;
  if (!need(m, n, ctx)) return "";
  if (!m.modules.length) { ctx.errors.push(`${ctx.where(n)}: srs.json has no "modules"`); return ""; }
  const cards = m.modules.map((mod) => {
    const ids = mod.reqs ?? [];
    const sts = ids.map((id) => status(m, id));
    const screens = [...new Set(ids.flatMap((id) => screensFor(m, id, { own: true })))];
    const ok = sts.filter(([s]) => s === "ok").length;
    const ui = sts.filter(([s]) => s !== "mute").length;
    const chips = ids.map((id, i) => `<span class="srs-dot ${sts[i][0]}" data-ref="${rRef(id)}" tabindex="0" title="${esc(`${id}: ${sts[i][1]}`)}">${esc(id)}</span>`).join("");
    const thumbs = screens.slice(0, 4).map((s) => `<div class="srs-thumb" data-ref="${sRef(s)}">${shot(m, s, { small: true })}<span>${esc(m.screens.get(s).label ?? s)}</span></div>`).join("");
    const worst = !ui ? "mute" : sts.some(([s]) => s === "risk") ? "risk" : sts.some(([s]) => s === "warn") ? "warn" : "ok";
    const head = ui ? `${ok} of ${ui} on screen` : "no UI";
    return `<div class="case srs-mod" data-st="${worst}"><span class="chip ${worst}">${head}</span><h3>${esc(mod.label ?? mod.id)}</h3>${mod.summary ? `<p>${esc(mod.summary)}</p>` : ""}<div class="srs-dots">${chips}</div>${thumbs ? `<div class="srs-thumbs">${thumbs}</div>` : ""}</div>`;
  });
  return `<div class="cases srs-mods">${cards.join("")}</div>`;
}

function traceTag(n, ctx) {
  const m = ctx.model;
  if (!need(m, n, ctx)) return "";
  let ids = [...m.reqs.keys()];
  if (n.attrs.module) {
    const mod = m.modules.find((x) => x.id === n.attrs.module);
    if (!mod) { ctx.errors.push(`${ctx.where(n)}: module="${n.attrs.module}" is not in srs.json`); return ""; }
    ids = mod.reqs ?? [];
  }
  if (n.attrs.kind) ids = ids.filter((id) => (m.reqs.get(id)?.kind ?? "functional") === n.attrs.kind);
  if (!ids.length) { ctx.errors.push(`${ctx.where(n)}: no requirement matches`); return ""; }
  const rows = ids.map((id) => {
    const r = m.reqs.get(id);
    const [st, word] = status(m, id);
    const scr = screensFor(m, id).map((s) => screenChip(m, s)).join("") || `<span class="srs-none">—</span>`;
    const meta = [r.section, r.priority].filter(Boolean).join(" · ");
    return `<tr data-ref="${rRef(id)}" tabindex="0"><th scope="row"><code>${esc(id)}</code></th><td>${esc(r.text)}${meta ? `<small>${esc(meta)}</small>` : ""}</td><td>${scr}</td><td><span class="chip ${st}">${word}</span></td></tr>`;
  }).join("");
  return `<div class="ve-table srs-trace"><table><thead><tr><th>ID</th><th>Requirement</th><th>Screens</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function gapsTag(n, ctx) {
  const m = ctx.model;
  if (!need(m, n, ctx)) return "";
  const only = n.attrs.only;
  const c = m.coverage, cases = [];
  const sev = (f) => (f.severity === "low" ? "warn" : f.type === "contradiction" || f.severity === "high" ? "risk" : "warn");
  const title = { contradiction: "Contradiction", missing_state: "State missing", ambiguity: "Ambiguous", note: "Note" };
  if (only !== "computed") for (const f of m.findings) {
    const refs = [f.req && rRef(f.req), f.screen && sRef(f.screen)].filter(Boolean).join(" ");
    const pic = f.screen ? shot(m, f.screen, { variant: f.variant, hl: f.hotspot }) : "";
    const versus = f.type === "contradiction" ? `<dl class="srs-vs"><div><dt>SRS says</dt><dd>${esc(f.srs_says)}</dd></div><div><dt>Screen shows</dt><dd>${esc(f.screen_shows)}</dd></div></dl>` : "";
    cases.push(`<div class="case srs-gap" data-st="${sev(f)}"${refs ? ` data-ref="${refs}"` : ""}><span class="chip ${sev(f)}">${title[f.type]}${f.req ? ` · ${esc(f.req)}` : ""}</span><h3>${esc(f.text)}</h3>${versus}${pic}</div>`);
  }
  if (only !== "findings") {
    for (const id of m.screens.size ? c.withoutScreen : []) {
      const r = m.reqs.get(id);
      cases.push(`<div class="case srs-gap" data-st="risk" data-ref="${rRef(id)}"><span class="chip risk">No screen · ${esc(id)}</span><h3>${esc(r.text)}</h3><p class="srs-note">No screenshot or transition satisfies this requirement.</p></div>`);
    }
    for (const d of c.deadControls) {
      cases.push(`<div class="case srs-gap" data-st="warn" data-ref="${sRef(d.screen)}"><span class="chip warn">Leads nowhere</span><h3>“${esc(d.label)}” on ${esc(m.screens.get(d.screen).label ?? d.screen)} has no destination</h3>${shot(m, d.screen, { variant: d.variant, hl: d.hotspot })}</div>`);
    }
    for (const s of c.unreachable) cases.push(`<div class="case srs-gap" data-st="risk" data-ref="${sRef(s)}"><span class="chip risk">Unreachable</span><h3>No control leads to ${esc(m.screens.get(s).label ?? s)}</h3>${shot(m, s, { small: true })}</div>`);
    for (const s of c.screensWithoutReq) cases.push(`<div class="case srs-gap" data-st="warn" data-ref="${sRef(s)}"><span class="chip warn">No requirement</span><h3>${esc(m.screens.get(s).label ?? s)} satisfies no requirement in the SRS</h3>${shot(m, s, { small: true })}</div>`);
    for (const g of c.inferredGroups) {
      const l = g[0], from = g.map((x) => m.screens.get(x.from).label ?? x.from);
      const on = g.length === 1 ? `on ${from[0]}` : `on ${g.length} screens`;
      cases.push(`<div class="case srs-gap" data-st="warn" data-ref="${[...new Set(g.map((x) => sRef(x.from)))].join(" ")} ${sRef(l.to)}"><span class="chip warn">Confirm</span><h3>“${esc(l.label ?? l.hotspot)}” → ${esc(m.screens.get(l.to).label ?? l.to)} is inferred ${esc(on)}</h3><p class="srs-note">${esc(l.reason)}</p>${g.length > 1 ? `<small class="srs-note">${esc(from.join(" · "))}</small>` : ""}</div>`);
    }
  }
  if (!cases.length) return `<p class="srs-note">No gaps: every UI requirement has a screen and every control leads somewhere.</p>`;
  return `<div class="cases srs-gaps">${cases.join("")}</div>`;
}

function screenTag(n, ctx) {
  const m = ctx.model;
  if (!need(m, n, ctx)) return "";
  const id = n.attrs.id, s = m.screens.get(id);
  if (!s) { ctx.errors.push(`${ctx.where(n)}: id="${id}" is not a screen in srs.json`); return ""; }
  const variant = n.attrs.variant;
  if (variant && !(s.variants ?? []).some((v) => v.id === variant)) { ctx.errors.push(`${ctx.where(n)}: variant="${variant}" is not on ${id}`); return ""; }
  if (n.attrs.hl && !m.hotspotOf(id, variant, n.attrs.hl)) { ctx.errors.push(`${ctx.where(n)}: hl="${n.attrs.hl}" is not a control on ${id}`); return ""; }
  const hs = (variant ? (s.variants.find((v) => v.id === variant).hotspots ?? s.hotspots) : s.hotspots) ?? [];
  const dead = new Set(m.coverage.deadControls.filter((d) => d.screen === id).map((d) => d.hotspot));
  const where = (h) => {
    if (h.in_place) return `<small>${esc(h.note ?? "acts in place")}</small>`;
    const out = m.links.filter((l) => l.from === id && l.hotspot === h.id);
    if (!out.length) return dead.has(h.id) ? `<span class="chip warn">leads nowhere</span>` : "";
    return out.map((l) => `→ ${screenChip(m, l.to)}${l.condition ? ` <small>${esc(l.condition)}</small>` : ""}${l.inferred ? ` <span class="chip warn">inferred</span>` : ""}`).join("<br>");
  };
  const legend = n.attrs.legend === "false" ? "" : `<ol class="srs-legend">${hs.map((h) => `<li><span class="srs-k">${esc(h.label ?? h.id)}</span> <span class="ve-label">${esc(h.kind)}</span> ${where(h)}</li>`).join("")}</ol>`;
  const refs = [sRef(id), ...(s.reqs ?? []).map((r) => rRef(r.id))].join(" ");
  return `<div class="srs-screen${legend ? "" : " no-legend"}" data-ref="${refs}">${shot(m, id, { variant, hl: n.attrs.hl, numbers: !!legend, dead })}${legend}</div>`;
}

function journeyTag(n, ctx) {
  const m = ctx.model;
  if (!need(m, n, ctx)) return "";
  const j = m.journeys.find((x) => x.id === n.attrs.id);
  if (!j) { ctx.errors.push(`${ctx.where(n)}: id="${n.attrs.id}" is not a journey in srs.json`); return ""; }
  if (!ctx.inSteps(n)) ctx.errors.push(`${ctx.where(n)}: put <ve-journey> inside <figure class="ve-steps">, so its player steps through it`);
  const steps = j.steps, total = steps.length;
  const stage = steps.map((s, k) => `<div class="srs-step ve-at" data-s="${k + 1}" data-ref="${sRef(s.screen)}${s.req ? ` ${rRef(s.req)}` : ""}">${shot(m, s.screen, { variant: s.variant, hl: s.hotspot })}</div>`).join("");
  const strip = steps.map((s, k) => {
    const sc = m.screens.get(s.screen), v = s.variant ? sc.variants.find((x) => x.id === s.variant) : null;
    return `<li data-s="0 ${k + 1}"><span class="srs-n">${k + 1}</span>${esc(sc.label ?? s.screen)}${v ? ` <small>${esc(v.label ?? v.id)}</small>` : ""}</li>`;
  }).join("");
  const caps = steps.map((s, k) => {
    const h = s.hotspot ? m.hotspotOf(s.screen, s.variant, s.hotspot) : null;
    return `<li data-n="${k + 1}/${total}">${esc(s.text)}${h ? ` <span class="srs-press">${esc(h.label ?? h.id)}</span>` : ""}${s.req ? ` ${reqChip(m, s.req)}` : ""}</li>`;
  }).join("");
  const who = j.actor ? m.actors.get(j.actor)?.label ?? j.actor : "";
  return `<div class="srs-journey" data-kind="${esc(j.kind ?? "happy")}"><p class="srs-jhead"><span class="chip ${j.kind === "failure" ? "risk" : j.kind === "alternate" ? "warn" : "ok"}">${esc(j.kind ?? "happy")} path</span>${who ? ` <span class="ve-label">${esc(who)}</span>` : ""}</p><ol class="srs-strip">${strip}</ol><div class="srs-stage">${stage}</div><div class="ve-player"><ol class="ve-cap">${caps}</ol><button data-go="-1" aria-label="Previous step">‹</button><button data-play>Play</button><input type="range" aria-label="Step"><button data-go="1" aria-label="Next step">›</button></div></div>`;
}

function protoTag(n, ctx) {
  const m = ctx.model;
  if (!need(m, n, ctx)) return "";
  if (!m.screens.size) { ctx.errors.push(`${ctx.where(n)}: the prototype needs screens in srs.json`); return ""; }
  const start = n.attrs.start ?? m.coverage.entries[0] ?? [...m.screens.keys()][0];
  if (!m.screens.has(start)) { ctx.errors.push(`${ctx.where(n)}: start="${start}" is not a screen`); return ""; }
  const pack = (s) => ({ label: s.label ?? s.id, img: s.asset?.key, size: s.asset?.size, hotspots: (s.hotspots ?? []).map(({ id, label, kind, box, in_place, note }) => ({ id, label, kind, box, in_place, note })), reqs: (s.reqs ?? []).map((r) => r.id) });
  const data = {
    start,
    screens: Object.fromEntries([...m.screens.values()].map((s) => [s.id, { ...pack(s), variants: Object.fromEntries((s.variants ?? []).map((v) => [v.id, { label: v.label ?? v.id, img: v.asset?.key, size: v.asset?.size, hotspots: (v.hotspots ?? s.hotspots ?? []).map(({ id, label, kind, box, in_place, note }) => ({ id, label, kind, box, in_place, note })) }])) }])),
    links: m.links.map(({ from, variant, hotspot, to, to_variant, label, condition, inferred }) => ({ from, variant, hotspot, to, to_variant, label, condition, inferred })),
    reqs: Object.fromEntries([...m.reqs.values()].map((r) => [r.id, r.text])),
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<div class="srs-proto" data-start="${esc(start)}"><div class="srs-pbar"><button data-p="back" aria-label="Back">‹ Back</button><nav class="srs-crumbs" aria-label="Path"></nav><button data-p="restart">Restart</button><button data-p="boxes" aria-pressed="false">Show controls</button></div><div class="srs-pview"></div><p class="srs-pnote" aria-live="polite"></p><script type="application/json" class="srs-pdata">${json}</script><noscript>${shot(m, start, { numbers: true })}</noscript></div>`;
}

function reqTag(n, ctx) {
  const m = ctx.model;
  if (!need(m, n, ctx)) return "";
  if (!m.reqs.has(n.attrs.id)) { ctx.errors.push(`${ctx.where(n)}: id="${n.attrs.id}" is not a requirement in the extraction`); return ""; }
  return reqChip(m, n.attrs.id);
}

export const SRS_TAGS = { "ve-coverage": coverageTag, "ve-modules": modulesTag, "ve-trace": traceTag, "ve-gaps": gapsTag, "ve-screen": screenTag, "ve-journey": journeyTag, "ve-proto": protoTag, "ve-req": reqTag };

/** One <style> holding every screenshot once, as a CSS variable each view points at. */
export const assetStyle = (m) => `<style data-srs-assets>\n:root {\n${[...m.assets.values()].map((a) => `  --srs-${a.key}: url("${a.uri}");`).join("\n")}\n}\n</style>`;
export { plural };
