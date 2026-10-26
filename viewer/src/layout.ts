// Left-to-right ELK layered layout. Sub-component nodes (node.hub set) are not given to
// ELK: each hub reserves room underneath itself and its circles are placed in a row there.
import ELK from "elkjs/lib/elk.bundled.js";
import type { GNode, Graph } from "./types";

export const G = {
  box: 64, // standard node square
  labelW: 170, // horizontal room reserved for the label under a node
  labelH: 48,
  hubH: 72,
  hubMinW: 220,
  portGap: 104,
  subD: 52, // circle diameter
  subGapY: 92, // hub bottom -> circle top
  subSpacing: 112,
  merge: 40,
  groupW: 96, // collapsed group card
};

export type Visual = "std" | "trigger" | "hub" | "sub" | "merge" | "group";

export function visualOf(n: GNode): Visual {
  if (n.collapsedGroup) return "group";
  if (n.hub) return "sub";
  if (n.kind === "hub") return "hub";
  if (n.kind === "trigger" || n.kind === "entrypoint") return "trigger";
  if (n.kind === "merge") return "merge";
  return "std";
}

export function hubWidth(n: GNode, subCount: number) {
  const ports = n.ports?.length ?? 0;
  return Math.max(G.hubMinW, ports * G.portGap, subCount * G.subSpacing);
}

export function portX(hubW: number, i: number, count: number) {
  return (hubW * (i + 1)) / (count + 1);
}

export interface Placed {
  x: number;
  y: number;
  w: number; // visual box size (what xyflow renders)
  h: number;
}

const elk = new ELK();

export async function layoutGraph(g: Graph): Promise<Map<string, Placed>> {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const subsOf = new Map<string, GNode[]>();
  for (const n of g.nodes) {
    if (n.hub && byId.get(n.hub)?.kind === "hub") {
      if (!subsOf.has(n.hub)) subsOf.set(n.hub, []);
      subsOf.get(n.hub)!.push(n);
    }
  }
  const owner = (id: string) => {
    const n = byId.get(id);
    return n?.hub && byId.has(n.hub) ? n.hub : id;
  };

  const main = g.nodes.filter((n) => visualOf(n) !== "sub" || !byId.has(n.hub!));
  const size = (n: GNode) => {
    const v = visualOf(n);
    if (v === "hub") {
      const subs = subsOf.get(n.id) ?? [];
      const w = hubWidth(n, subs.length);
      const h = G.hubH + (subs.length ? G.subGapY + G.subD + G.labelH : 30);
      return { w: w + 40, h };
    }
    if (v === "merge") return { w: G.labelW, h: G.merge + G.labelH };
    if (v === "group") return { w: G.labelW, h: G.box + G.labelH + 8 };
    return { w: G.labelW, h: G.box + G.labelH };
  };

  const seen = new Set<string>();
  const elkEdges: { id: string; sources: string[]; targets: string[] }[] = [];
  for (const e of g.edges) {
    if (e.kind !== "main") continue;
    const s = owner(e.from), t = owner(e.to);
    const key = `${s}->${t}`;
    if (s === t || seen.has(key) || !byId.has(s) || !byId.has(t)) continue;
    seen.add(key);
    elkEdges.push({ id: key, sources: [s], targets: [t] });
  }

  // A dependency edge is given to ELK only when it bridges two otherwise separate components
  // (e.g. a cron job and the DB it reads), so it stays near the rest without reshuffling layers.
  const comp = new Map<string, string>();
  const find = (x: string): string => {
    const p = comp.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    comp.set(x, r);
    return r;
  };
  for (const e of elkEdges) comp.set(find(e.sources[0]), find(e.targets[0]));
  for (const e of g.edges) {
    if (e.kind !== "dependency") continue;
    const s = owner(e.from), t = owner(e.to);
    if (s === t || !byId.has(s) || !byId.has(t) || find(s) === find(t)) continue;
    comp.set(find(s), find(t));
    elkEdges.push({ id: `${s}->${t}`, sources: [s], targets: [t] });
  }

  const res = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "170",
      "elk.spacing.nodeNode": "36",
      "elk.spacing.componentComponent": "90",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.separateConnectedComponents": "true",
    },
    children: main.map((n) => ({ id: n.id, width: size(n).w, height: size(n).h })),
    edges: elkEdges,
  });

  const out = new Map<string, Placed>();
  for (const c of res.children ?? []) {
    const n = byId.get(c.id)!;
    const v = visualOf(n);
    const W = c.width!, x = c.x!, y = c.y!;
    if (v === "hub") {
      const subs = subsOf.get(n.id) ?? [];
      const hw = hubWidth(n, subs.length);
      const hx = x + (W - hw) / 2;
      out.set(n.id, { x: hx, y, w: hw, h: G.hubH });
      // Circles go under their port; several circles on one port fan out around it.
      const ports = n.ports ?? [];
      const byPort = new Map<string, GNode[]>();
      for (const s of subs) {
        const k = s.port && ports.includes(s.port) ? s.port : "";
        if (!byPort.has(k)) byPort.set(k, []);
        byPort.get(k)!.push(s);
      }
      const centers: [GNode, number][] = [];
      for (const [p, list] of byPort) {
        const px = p ? portX(hw, ports.indexOf(p), ports.length) : hw / 2;
        list.forEach((s, j) => centers.push([s, px + (j - (list.length - 1) / 2) * G.subSpacing]));
      }
      // Resolve overlaps left-to-right, then re-center the row under the hub.
      centers.sort((a, b) => a[1] - b[1]);
      for (let i = 1; i < centers.length; i++) {
        centers[i][1] = Math.max(centers[i][1], centers[i - 1][1] + G.subSpacing);
      }
      if (centers.length) {
        const mid = (centers[0][1] + centers[centers.length - 1][1]) / 2;
        const shift = Math.abs(mid - hw / 2) > hw / 2 ? hw / 2 - mid : 0;
        for (const c2 of centers) {
          out.set(c2[0].id, { x: hx + c2[1] + shift - G.subD / 2, y: y + G.hubH + G.subGapY, w: G.subD, h: G.subD });
        }
      }
    } else if (v === "group") {
      out.set(n.id, { x: x + (W - G.groupW) / 2, y, w: G.groupW, h: G.box });
    } else {
      const b = v === "merge" ? G.merge : G.box;
      out.set(n.id, { x: x + (W - b) / 2, y, w: b, h: b });
    }
  }
  return out;
}

export function boxSize(n: GNode): { w: number; h: number } {
  const v = visualOf(n);
  if (v === "hub") return { w: hubWidth(n, 0), h: G.hubH };
  if (v === "sub") return { w: G.subD, h: G.subD };
  if (v === "merge") return { w: G.merge, h: G.merge };
  if (v === "group") return { w: G.groupW, h: G.box };
  return { w: G.box, h: G.box };
}

/** Only what changes the automatic layout: label or summary edits must not re-run ELK. */
export function layoutKey(g: Graph) {
  return JSON.stringify([
    g.nodes.map((n) => [n.id, n.kind, n.hub ?? "", n.port ?? "", n.ports ?? [], n.collapsedGroup ?? ""]),
    g.edges.map((e) => [e.from, e.to, e.kind]),
  ]);
}

/** Apply positions saved from the editor. Circles of a moved hub move with it unless pinned. */
export function withManual(auto: Map<string, Placed>, nodes: GNode[], drag?: Map<string, { x: number; y: number }>) {
  const out = new Map(auto);
  const moved = new Map<string, { dx: number; dy: number }>();
  for (const n of nodes) {
    const m = drag?.get(n.id) ?? n.pos;
    // Nodes added in the editor have a position but were never laid out.
    const p = out.get(n.id) ?? (m ? { x: m.x, y: m.y, ...boxSize(n) } : undefined);
    if (!p || !m) continue;
    moved.set(n.id, { dx: m.x - p.x, dy: m.y - p.y });
    out.set(n.id, { ...p, x: m.x, y: m.y });
  }
  for (const n of nodes) {
    if (!n.hub || n.pos || drag?.has(n.id)) continue;
    const d = moved.get(n.hub);
    const p = out.get(n.id);
    if (d && p) out.set(n.id, { ...p, x: p.x + d.dx, y: p.y + d.dy });
  }
  return out;
}
