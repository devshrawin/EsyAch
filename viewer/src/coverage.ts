// Mode B coverage, computed live so editor changes update the Coverage panel and the badges.
// Mirrors scripts/fm_spec.py.
import type { Finding, GNode, Graph } from "./types";

export interface Coverage {
  total: number;
  covered: string[];
  withoutScreen: string[];
  nonUi: string[];
  screensWithoutReq: string[];
  deadEnds: string[];
  unreachable: string[];
  deadHotspots: { screen: string; hotspot: string; label: string }[];
  inferred: string[];
  findings: Finding[];
  entries: string[];
  reqScreens: Map<string, string[]>; // requirement -> screens
  reqEdges: Map<string, string[]>; // requirement -> edges
}

export function coverage(g: Graph): Coverage {
  const screens = new Map(g.nodes.filter((n) => n.kind === "screen").map((n) => [n.id, n]));
  const reqs = new Map((g.requirements ?? []).map((r) => [r.id, r]));
  const nav = g.edges.filter((e) => screens.has(e.from) && screens.has(e.to));
  const reqScreens = new Map<string, string[]>();
  const reqEdges = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const n of screens.values()) for (const r of n.requirements ?? []) push(reqScreens, r.id, n.id);
  for (const e of nav) for (const r of e.reqs ?? []) push(reqEdges, r, e.id);
  const isUi = (id: string) => reqs.get(id)?.ui !== false;
  const covered = [...reqs.keys()].filter((r) => isUi(r) && (reqScreens.has(r) || reqEdges.has(r)));

  const adj = new Map<string, string[]>([...screens.keys()].map((s) => [s, []]));
  const outOther = new Map<string, number>([...screens.keys()].map((s) => [s, 0]));
  for (const e of nav) {
    if (e.from === e.to) continue;
    adj.get(e.from)!.push(e.to);
    outOther.set(e.from, outOther.get(e.from)! + 1);
  }
  let entries = [...screens.values()].filter((n) => n.entry).map((n) => n.id);
  if (!entries.length) {
    const inbound = new Set(nav.filter((e) => e.from !== e.to).map((e) => e.to));
    entries = [...screens.keys()].filter((s) => !inbound.has(s));
  }
  const seen = new Set(entries);
  const q = [...entries];
  while (q.length) for (const t of adj.get(q.shift()!) ?? []) if (!seen.has(t)) { seen.add(t); q.push(t); }

  const linked = new Set(nav.map((e) => `${e.from}|${e.hotspot}`));
  const deadHotspots: Coverage["deadHotspots"] = [];
  for (const [s, n] of screens) {
    for (const h of n.hotspots ?? []) {
      if (!linked.has(`${s}|${h.id}`) && ["button", "link", "tab", "menu"].includes(h.kind) && !h.in_place) {
        deadHotspots.push({ screen: s, hotspot: h.id, label: h.label });
      }
    }
  }
  return {
    total: [...reqs.keys()].filter(isUi).length,
    covered,
    withoutScreen: [...reqs.keys()].filter((r) => isUi(r) && !covered.includes(r)),
    nonUi: [...reqs.keys()].filter((r) => !isUi(r)),
    screensWithoutReq: [...screens.values()].filter((n) => !n.requirements?.length).map((n) => n.id),
    deadEnds: [...screens.keys()].filter((s) => outOther.get(s) === 0),
    unreachable: [...screens.keys()].filter((s) => !seen.has(s)),
    deadHotspots,
    inferred: nav.filter((e) => e.inferred).map((e) => e.id),
    findings: g.findings ?? [],
    entries,
    reqScreens,
    reqEdges,
  };
}

export type BadgeSev = "red" | "amber";
export function badges(c: Coverage): Map<string, { sev: BadgeSev; text: string }[]> {
  const out = new Map<string, { sev: BadgeSev; text: string }[]>();
  const add = (s: string, sev: BadgeSev, text: string) => out.set(s, [...(out.get(s) ?? []), { sev, text }]);
  for (const f of c.findings) if (f.screen) add(f.screen, (f.severity ?? "high") === "high" ? "red" : "amber", f.text);
  for (const s of c.screensWithoutReq) add(s, "amber", "No requirement linked");
  for (const s of c.deadEnds) add(s, "amber", "Dead end: no way to leave this screen");
  for (const s of c.unreachable) add(s, "red", "Unreachable from the entry screen");
  for (const h of c.deadHotspots) add(h.screen, "amber", `"${h.label}" leads nowhere`);
  return out;
}

export function assetSrc(g: Graph, n: GNode, variant?: string): string | undefined {
  const name = variant ? n.variants?.find((v) => v.id === variant)?.image : n.image;
  const src = name ? g.assets?.[name] : undefined;
  return src && src.startsWith("data:image/") ? src : undefined; // only embedded images, never URLs
}
