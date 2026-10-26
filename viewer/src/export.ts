// Exports. The SVG is drawn from the same geometry as the canvas (real shapes and text, not a
// DOM screenshot), so it opens cleanly in Figma/Inkscape/browsers. PNG rasterises that SVG.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getBezierPath, Position } from "@xyflow/react";
import { bezierPoint } from "./edges";
import { Icon, iconFor } from "./icons";
import { portX, type Placed, type Visual } from "./layout";
import type { Flow, GEdge, GNode, Graph } from "./types";
import { TEMPLATE } from "./template";

export interface RNode {
  n: GNode; p: Placed; v: Visual; dim: boolean; inFlow: boolean; current: boolean; hasOut: boolean;
}
export interface REdge {
  e: GEdge; dim: boolean; inFlow: boolean; current: boolean; cross: boolean; fanOut: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function themeVars() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, d: string) => cs.getPropertyValue(k).trim() || d;
  return {
    bg: v("--bg", "#2a2a2a"), dot: v("--dot", "#4a4a4c"), node: v("--node-bg", "#404143"), sub: v("--sub-bg", "#2f3036"),
    border: v("--node-border", "#c9cacf"), edge: v("--edge", "#b9babd"), active: v("--edge-active", "#fff"),
    text: v("--text", "#ececec"), muted: v("--muted", "#9b9ea4"), accent: v("--accent", "#ff6d5a"), handle: v("--handle", "#c9cacf"),
  };
}

function iconMarkup(n: GNode, x: number, y: number, size: number, colorOverride?: string) {
  const { icon, color } = iconFor(n);
  const c = colorOverride ?? color;
  const name = n.collapsedGroup ? "layers" : icon;
  return renderToStaticMarkup(createElement(Icon, { name, size }))
    .replace("<svg ", `<svg x="${x}" y="${y}" `)
    .replace(/currentColor/g, c)
    .replace(/ aria-hidden="true"/, "");
}

function handlePoint(p: Placed, n: GNode, h: string): [number, number] {
  if (h === "out") return [p.x + p.w, p.y + p.h / 2];
  if (h === "in") return [p.x, p.y + p.h / 2];
  if (h === "top") return [p.x + p.w / 2, p.y];
  if (h.startsWith("port-")) {
    const ports = n.ports ?? [];
    const i = ports.indexOf(h.slice(5));
    if (i >= 0) return [p.x + portX(p.w, i, ports.length), p.y + p.h];
  }
  return [p.x + p.w / 2, p.y + p.h];
}

export function renderSVG(nodes: RNode[], edges: REdge[], opt: { payloads: boolean; title?: string }) {
  const t = themeVars();
  const byId = new Map(nodes.map((r) => [r.n.id, r]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of nodes) {
    minX = Math.min(minX, r.p.x - 40);
    minY = Math.min(minY, r.p.y - 30);
    maxX = Math.max(maxX, r.p.x + r.p.w + 60);
    maxY = Math.max(maxY, r.p.y + r.p.h + 60);
  }
  if (!nodes.length) [minX, minY, maxX, maxY] = [0, 0, 400, 200];
  const pad = 40, top = opt.title ? 40 : 0;
  const ox = -minX + pad, oy = -minY + pad + top;
  const W = Math.ceil(maxX - minX + pad * 2), H = Math.ceil(maxY - minY + pad * 2 + top);
  const parts: string[] = [];
  const font = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"`;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${font}>`);
  parts.push(`<defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.4" cy="1.4" r="1.4" fill="${t.dot}"/></pattern>`);
  for (const [id, c] of [["a", t.edge], ["b", t.active], ["c", t.accent]]) {
    parts.push(`<marker id="arr-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`);
  }
  parts.push(`</defs><rect width="100%" height="100%" fill="${t.bg}"/><rect width="100%" height="100%" fill="url(#dots)"/>`);
  if (opt.title) parts.push(`<text x="${pad}" y="${pad}" font-size="18" font-weight="700" fill="${t.text}">${esc(opt.title)}</text>`);
  parts.push(`<g transform="translate(${ox},${oy})">`);

  // edges first, nodes on top (as on the canvas)
  for (const r of edges) {
    const e = r.e;
    const s = byId.get(e.from), d = byId.get(e.to);
    if (!s || !d) continue;
    const dep = e.kind === "dependency";
    const sh = dep ? (e.port ? `port-${e.port}` : "bottom") : "out";
    const th = dep ? "top" : "in";
    const [sx, sy] = handlePoint(s.p, s.n, sh);
    const [tx, ty] = handlePoint(d.p, d.n, th);
    const [path, lx, ly] = getBezierPath({
      sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
      sourcePosition: dep ? Position.Bottom : Position.Right, targetPosition: dep ? Position.Top : Position.Left,
      curvature: dep ? 0.35 : 0.3,
    });
    const color = r.current ? t.accent : r.inFlow ? t.active : t.edge;
    const marker = dep ? "" : ` marker-end="url(#arr-${r.current ? "c" : r.inFlow ? "b" : "a"})"`;
    const dash = dep ? ` stroke-dasharray="${e.inferred ? "3 6" : "5 5"}"` : e.inferred ? ` stroke-dasharray="3 6"` : "";
    const op = r.dim ? 0.18 : r.cross && !r.inFlow ? 0.55 : 1;
    parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="${r.current ? 2.8 : r.inFlow ? 2.2 : 1.5}"${dash}${marker} opacity="${op}"/>`);
    const lop = r.dim ? 0.15 : 1;
    if (!dep && e.label) {
      const q = r.fanOut ? bezierPoint(sx, sy, tx, ty, 0.3, 0.2) : { x: sx + 9, y: sy };
      const anchor = r.fanOut ? "middle" : "start";
      parts.push(`<text x="${q.x}" y="${q.y - 5}" font-size="10" text-anchor="${anchor}" fill="${t.muted}" opacity="${lop}">${esc(clip(e.label, 24))}</text>`);
    }
    let pill = dep ? (r.cross ? e.label : undefined) : e.condition ? `if ${e.condition}` : e.payload;
    if (r.cross && !r.inFlow) pill = undefined;
    if (!opt.payloads && !dep) pill = undefined;
    if (pill) {
      const txt = clip(pill, 34);
      const w = txt.length * 5.6 + 10;
      parts.push(`<rect x="${lx - w / 2}" y="${ly - 8}" width="${w}" height="16" rx="8" fill="${t.bg}" opacity="${lop}"/>`);
      parts.push(`<text x="${lx}" y="${ly + 3.5}" font-size="10" text-anchor="middle" fill="${t.muted}" opacity="${lop}">${esc(txt)}</text>`);
    }
    if (e.inferred) parts.push(`<circle cx="${lx + 4}" cy="${ly - 12}" r="7" fill="#f0a33f"/><text x="${lx + 4}" y="${ly - 8.5}" font-size="10" font-weight="700" text-anchor="middle" fill="#222">?</text>`);
  }

  for (const r of nodes) {
    const { n, p, v } = r;
    const { x, y, w, h } = p;
    const op = r.dim ? 0.2 : n.status === "deactivated" ? 0.45 : 1;
    const stroke = r.current ? t.accent : t.border;
    const sw = r.current ? 2.5 : 1.5;
    const dash = n.status === "deactivated" || n.confidence === "low" ? ` stroke-dasharray="5 4"` : "";
    parts.push(`<g opacity="${op}">`);
    if (v === "group") {
      parts.push(`<rect x="${x + 10}" y="${y - 10}" width="${w}" height="${h}" rx="10" fill="${t.node}" stroke="${t.border}" stroke-width="1.5" opacity="0.45"/>`);
      parts.push(`<rect x="${x + 5}" y="${y - 5}" width="${w}" height="${h}" rx="10" fill="${t.node}" stroke="${t.border}" stroke-width="1.5" opacity="0.7"/>`);
    }
    if (v === "sub") {
      parts.push(`<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}" fill="${t.sub}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`);
      parts.push(`<rect x="${x + w / 2 - 4}" y="${y - 4}" width="8" height="8" fill="${t.handle}" transform="rotate(45 ${x + w / 2} ${y})"/>`);
      if (n.port) parts.push(`<text x="${x + w / 2}" y="${y - 12}" font-size="10" text-anchor="middle" fill="${t.muted}">${esc(n.port)}</text>`);
    } else if (v === "trigger") {
      const rr = 30;
      parts.push(`<path d="M${x + rr} ${y} H${x + w - 8} a8 8 0 0 1 8 8 V${y + h - 8} a8 8 0 0 1 -8 8 H${x + rr} a${rr} ${rr} 0 0 1 -${rr} -${rr} V${y + h - rr} V${y + rr} a${rr} ${rr} 0 0 1 ${rr} -${rr} Z" fill="${t.node}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`);
      const by = hasIn(n, edges) ? y + 6 : y + h / 2 - 8;
      parts.push(`<path transform="translate(${x - 24},${by}) scale(0.6667)" d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" fill="${t.accent}"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${v === "merge" ? 8 : 10}" fill="${t.node}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`);
    }
    // handles
    if (v !== "sub") parts.push(`<rect x="${x - 2.5}" y="${y + h / 2 - 7}" width="5" height="14" rx="1" fill="${t.handle}"/>`);
    if (v !== "sub" || r.hasOut) parts.push(`<circle cx="${x + w}" cy="${y + h / 2}" r="5.5" fill="${t.handle}"/>`);
    if (!r.hasOut && v !== "sub") {
      parts.push(`<line x1="${x + w + 5}" y1="${y + h / 2}" x2="${x + w + 39}" y2="${y + h / 2}" stroke="${t.edge}" stroke-width="1.5"/>`);
      parts.push(`<rect x="${x + w + 39}" y="${y + h / 2 - 9}" width="18" height="18" rx="4" fill="none" stroke="${t.border}" stroke-width="1.5"/>`);
      parts.push(`<text x="${x + w + 48}" y="${y + h / 2 + 4.5}" font-size="13" text-anchor="middle" fill="${t.muted}">+</text>`);
    }
    const deact = n.status === "deactivated" ? " (Deactivated)" : "";
    if (v === "hub") {
      parts.push(iconMarkup(n, x + 16, y + h / 2 - 14, 28));
      parts.push(`<text x="${x + 56}" y="${y + h / 2 - 2}" font-size="14" font-weight="600" fill="${t.text}">${esc(n.label + deact)}</text>`);
      if (n.subtitle) parts.push(`<text x="${x + 56}" y="${y + h / 2 + 14}" font-size="11" fill="${t.muted}">${esc(clip(n.subtitle, Math.floor((w - 70) / 6)))}</text>`);
      const ports = n.ports ?? [];
      ports.forEach((pn, i) => {
        const px = x + portX(w, i, ports.length);
        parts.push(`<rect x="${px - 4.5}" y="${y + h - 4.5}" width="9" height="9" fill="${t.handle}" transform="rotate(45 ${px} ${y + h})"/>`);
        parts.push(`<text x="${px}" y="${y + h + 22}" font-size="11" text-anchor="middle" fill="${t.muted}">${esc(pn)}</text>`);
      });
    } else {
      const is = v === "sub" ? 24 : v === "merge" ? 20 : 30;
      parts.push(iconMarkup(n, x + w / 2 - is / 2, y + h / 2 - is / 2, is, v === "group" ? "#c9ccd1" : undefined));
      const lw = v === "sub" ? 18 : 26;
      parts.push(`<text x="${x + w / 2}" y="${y + h + 20}" font-size="${v === "sub" ? 12 : 13}" font-weight="600" text-anchor="middle" fill="${t.text}">${esc(clip(n.label, lw))}</text>`);
      let ly = y + h + 20;
      if (deact) {
        ly += 15;
        parts.push(`<text x="${x + w / 2}" y="${ly}" font-size="12" text-anchor="middle" fill="${t.muted}">(Deactivated)</text>`);
      }
      if (n.subtitle) parts.push(`<text x="${x + w / 2}" y="${ly + 15}" font-size="11" text-anchor="middle" fill="${t.muted}">${esc(clip(n.subtitle, v === "sub" ? 17 : lw + 6))}</text>`);
    }
    if (v === "group") {
      parts.push(`<circle cx="${x + w + 6}" cy="${y - 6}" r="10" fill="${t.accent}"/><text x="${x + w + 6}" y="${y - 2}" font-size="11" font-weight="700" text-anchor="middle" fill="#fff">${n.count}</text>`);
    }
    if (n.confirmed) parts.push(`<circle cx="${x}" cy="${y}" r="9" fill="#4cc38a"/><text x="${x}" y="${y + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="#0f2a1c">✓</text>`);
    parts.push(`</g>`);
  }
  parts.push(`</g></svg>`);
  return { svg: parts.join("\n"), width: W, height: H };
}

function hasIn(n: GNode, edges: REdge[]) {
  return edges.some((r) => r.e.to === n.id && r.e.kind === "main");
}

export async function svgToPng(svg: string, w: number, h: number, scale = 2): Promise<Blob> {
  const s = Math.max(0.25, Math.min(scale, 16000 / Math.max(w, h)));
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG encoding failed"))), "image/png"));
}

// ------------------------------------------------------------------ Mermaid

const mid = (id: string) => id.replace(/[^\w]/g, "_");
const mlabel = (s: string) => s.replace(/"/g, "#quot;").replace(/[<>]/g, "");

export function toMermaid(g: Graph, flow?: Flow) {
  const lines = ["flowchart LR"];
  const shape = (n: GNode) => {
    const text = `"${mlabel(n.label)}${n.status === "deactivated" ? " (Deactivated)" : ""}${n.subtitle ? `<br/><small>${mlabel(n.subtitle)}</small>` : ""}"`;
    if (n.kind === "trigger" || n.kind === "entrypoint") return `([${text}])`;
    if (n.kind === "datastore") return `[(${text})]`;
    if (n.kind === "queue") return `[/${text}/]`;
    if (n.kind === "external") return `{{${text}}}`;
    if (n.kind === "hub") return `[[${text}]]`;
    if (n.hub) return `((${text}))`;
    return `[${text}]`;
  };
  const inGroup = new Map<string, GNode[]>();
  const loose: GNode[] = [];
  for (const n of g.nodes) {
    if (n.group && g.groups?.some((x) => x.id === n.group)) {
      if (!inGroup.has(n.group)) inGroup.set(n.group, []);
      inGroup.get(n.group)!.push(n);
    } else loose.push(n);
  }
  for (const [gid, list] of inGroup) {
    const label = g.groups!.find((x) => x.id === gid)!.label;
    lines.push(`  subgraph ${mid("grp_" + gid)}["${mlabel(label)}"]`);
    for (const n of list) lines.push(`    ${mid(n.id)}${shape(n)}`);
    lines.push("  end");
  }
  for (const n of loose) lines.push(`  ${mid(n.id)}${shape(n)}`);
  const flowEdges = new Set(flow?.steps.map((s) => s.edge).filter(Boolean));
  const hi: number[] = [];
  g.edges.forEach((e, i) => {
    const arrow = e.kind === "dependency" || e.inferred ? "-.->" : "-->";
    const label = e.label ? `|"${mlabel(e.label)}"|` : "";
    lines.push(`  ${mid(e.from)} ${arrow}${label} ${mid(e.to)}`);
    if (flowEdges.has(e.id)) hi.push(i);
  });
  const deact = g.nodes.filter((n) => n.status === "deactivated").map((n) => mid(n.id));
  if (deact.length) {
    lines.push("  classDef deactivated opacity:0.45,stroke-dasharray:4 3");
    lines.push(`  class ${deact.join(",")} deactivated`);
  }
  if (flow) {
    lines.push(`  %% Highlighted flow: ${flow.name}`);
    if (hi.length) lines.push(`  linkStyle ${hi.join(",")} stroke:#ff6d5a,stroke-width:3px`);
  }
  lines.push("");
  for (const f of g.flows) {
    lines.push(`%% Flow "${f.name}" (${f.kind ?? "happy"}): ${f.steps.map((s) => g.nodes.find((n) => n.id === s.node)?.label ?? s.node).join(" -> ")}`);
  }
  return lines.join("\n") + "\n";
}

// ------------------------------------------------------------------ files

export function download(name: string, data: Blob | string, mime = "application/octet-stream") {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flowmap";
}

/** The graph as it should be saved (view-only fields never leak into it). */
export function toJSON(g: Graph) {
  return JSON.stringify(g, (k, v) => (k === "collapsedGroup" || k === "count" || k === "aggregate" ? undefined : v), 2) + "\n";
}

/** A new self-contained HTML with this graph embedded, or null when running from the dev server. */
export function buildHTML(g: Graph): string | null {
  if (!TEMPLATE) return null;
  const json = JSON.stringify(JSON.parse(toJSON(g))).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
  const re = /(<script id="flowmap-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
  if (!re.test(TEMPLATE)) return null;
  return "<!doctype html>\n" + TEMPLATE.replace(re, (_m, a, _b, c) => a + json + c);
}

// ------------------------------------------------------------------ print / PDF book

export function printBook(g: Graph, overview: string, perFlow: { flow: Flow; svg: string }[]) {
  const label = (id: string) => g.nodes.find((n) => n.id === id)?.label ?? id;
  const ev = (e?: { file?: string; line?: number; req?: string }) => (e ? (e.file ? `${e.file}:${e.line}` : e.req ?? "") : "");
  const sections = perFlow.map(({ flow, svg }) => `
    <section class="flow">
      <h2>${esc(flow.name)} <small>${esc(flow.kind ?? "happy")}${flow.actor ? " · " + esc(flow.actor) : ""}</small></h2>
      ${flow.description ? `<p>${esc(flow.description)}</p>` : ""}
      <div class="map">${svg}</div>
      <table><thead><tr><th>#</th><th>Node</th><th>What happens</th><th>Payload</th><th>Evidence</th></tr></thead><tbody>
      ${flow.steps.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(label(s.node))}</td><td>${esc(s.description)}</td><td><code>${esc(s.payload ?? "")}</code></td><td><code>${esc(ev(s.evidence))}</code></td></tr>`).join("")}
      </tbody></table>
    </section>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(g.project.name)} · flowmap</title><style>
    body{font:12px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2024;margin:24px}
    h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:0 0 6px} h2 small{font-weight:400;color:#666;font-size:12px}
    .map svg{width:100%;height:auto;border-radius:8px} section{page-break-before:always}
    table{border-collapse:collapse;width:100%;margin-top:10px} th,td{border-bottom:1px solid #ddd;text-align:left;padding:4px 6px;vertical-align:top}
    code{font:11px ui-monospace,Menlo,Consolas,monospace} @page{size:A4 landscape;margin:12mm}
  </style></head><body>
    <h1>${esc(g.project.name)}</h1><p>${esc(g.project.summary ?? "")}</p>
    <p>${g.nodes.length} nodes · ${g.edges.length} edges · ${g.flows.length} flows</p>
    <div class="map">${overview}</div>${sections}</body></html>`;
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  iframe.setAttribute("data-flowmap-print", "");
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 60_000);
  };
  iframe.srcdoc = html;
}

