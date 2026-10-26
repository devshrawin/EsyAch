// View transform: detail level, filters and collapsed groups turn the saved graph into the
// graph that is laid out and drawn. Hidden or collapsed nodes are remapped to whatever now
// stands for them (their hub, or their group's node) so flows still light up the right path.
import type { GEdge, GNode, Graph } from "./types";

export type Level = "overview" | "structure" | "detail";

export interface ViewOpts {
  level: Level;
  hiddenKinds: Set<string>;
  hiddenLayers: Set<string>;
  showDeps: boolean;
  showDeactivated: boolean;
  collapsed: Set<string>;
  showGlobal?: boolean; // Mode B: header links / sign-out available on every screen
  actor?: string | null; // Mode B: only screens this actor sees
}

export interface ViewGraph {
  nodes: GNode[];
  edges: GEdge[];
  nodeMap: Map<string, string>; // original node id -> view node id (absent = hidden)
  edgeMap: Map<string, string>; // original edge id -> view edge id
}

export interface Group {
  id: string;
  label: string;
  auto?: boolean;
}

export const AUTO_GROUP_MIN = 60; // graphs bigger than this without groups get folder groups
export const AUTO_COLLAPSE_MIN = 150; // ... and start collapsed above this size

/** Declared groups, or (for big ungrouped graphs) one group per top-level folder. */
export function groupsOf(g: Graph): { groups: Group[]; groupOf: Map<string, string> } {
  const groupOf = new Map<string, string>();
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  if (g.groups?.length) {
    for (const n of g.nodes) if (n.group) groupOf.set(n.id, n.group);
  } else if (g.nodes.length > AUTO_GROUP_MIN) {
    for (const n of g.nodes) {
      const f = n.files?.[0];
      if (f) groupOf.set(n.id, f.includes("/") ? f.split("/")[0] + "/" : "(root)");
    }
  }
  // Circles travel with their hub.
  for (const n of g.nodes) {
    if (n.hub && byId.has(n.hub)) {
      const hg = groupOf.get(n.hub);
      if (hg) groupOf.set(n.id, hg);
    }
  }
  const groups: Group[] = g.groups?.length
    ? g.groups.map((x) => ({ id: x.id, label: x.label }))
    : [...new Set(groupOf.values())].sort().map((id) => ({ id, label: id, auto: true }));
  return { groups, groupOf };
}

export function buildView(g: Graph, o: ViewOpts, keepEdges: Set<string> = new Set()): ViewGraph {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const { groups, groupOf } = groupsOf(g);
  const nodeMap = new Map<string, string>();
  const visible = (n: GNode) =>
    !(o.actor && n.kind === "screen" && n.actors?.length && !n.actors.includes(o.actor)) &&
    !o.hiddenKinds.has(n.kind) && !(n.layer && o.hiddenLayers.has(n.layer)) &&
    (o.showDeactivated || n.status !== "deactivated");

  const out: GNode[] = [];
  const groupNodes = new Map<string, GNode>();
  for (const n of g.nodes) {
    if (!visible(n)) continue;
    if (n.hub && byId.has(n.hub) && !visible(byId.get(n.hub)!)) continue;
    const gid = groupOf.get(n.id);
    if (gid && o.collapsed.has(gid)) {
      const id = `group:${gid}`;
      if (!groupNodes.has(id)) {
        const label = groups.find((x) => x.id === gid)?.label ?? gid;
        const gn: GNode = { id, label, kind: "module", collapsedGroup: gid, count: 0, confidence: "high" };
        groupNodes.set(id, gn);
        out.push(gn);
      }
      groupNodes.get(id)!.count! += 1;
      nodeMap.set(n.id, id);
      continue;
    }
    if (o.level === "overview" && n.hub && byId.has(n.hub)) {
      nodeMap.set(n.id, n.hub); // circles fold into their hub
      continue;
    }
    nodeMap.set(n.id, n.id);
    out.push(n);
  }
  for (const gn of groupNodes.values()) gn.subtitle = `${gn.count} node${gn.count === 1 ? "" : "s"} · collapsed`;
  // A circle folded into a hub that is itself collapsed must follow it.
  for (const [k, v] of nodeMap) {
    const t = nodeMap.get(v);
    if (t && t !== v) nodeMap.set(k, t);
  }

  const edgeMap = new Map<string, string>();
  const merged = new Map<string, GEdge>();
  const showDeps = o.showDeps && o.level !== "overview";
  for (const e of g.edges) {
    if (e.kind === "dependency" && !showDeps) continue;
    if (e.global && !o.showGlobal && !keepEdges.has(e.id)) continue;
    const s = nodeMap.get(e.from), t = nodeMap.get(e.to);
    if (!s || !t) continue;
    if (s === t && (e.from !== e.to || s !== e.from)) continue; // folded into one node: drop; a real self-loop stays
    const remapped = s !== e.from || t !== e.to;
    const key = `${s}>${t}:${e.kind}`;
    const prev = merged.get(key);
    if (!prev) {
      const ve: GEdge = remapped ? { ...e, id: `v:${key}`, from: s, to: t, port: undefined, aggregate: [e.id] } : e;
      merged.set(key, ve);
      edgeMap.set(e.id, ve.id);
    } else {
      // Several edges between the same pair: merge into one, keep the list for the hover card.
      const agg = prev.aggregate ?? [prev.id];
      const ve: GEdge = { ...prev, id: `v:${key}`, aggregate: [...agg, e.id], label: `${agg.length + 1} links`, payload: undefined, condition: undefined };
      merged.set(key, ve);
      for (const id of ve.aggregate!) edgeMap.set(id, ve.id);
    }
  }
  return { nodes: out, edges: [...merged.values()], nodeMap, edgeMap };
}

// ------------------------------------------------------------------ lightweight checks
// Mirrors the structural rules of scripts/validate.py so edits show problems immediately.

export interface Problem {
  msg: string;
  node?: string;
  edge?: string;
  flow?: string;
}

const START_KINDS = new Set(["entrypoint", "trigger", "ui", "screen"]);

export function checkGraph(g: Graph): Problem[] {
  const p: Problem[] = [];
  const nodes = new Map<string, GNode>();
  for (const n of g.nodes) {
    if (nodes.has(n.id)) p.push({ msg: `Duplicate node id ${n.id}`, node: n.id });
    nodes.set(n.id, n);
    if (n.hub && nodes.get(n.hub) === undefined && !g.nodes.some((x) => x.id === n.hub)) {
      p.push({ msg: `${n.label}: attached to missing hub ${n.hub}`, node: n.id });
    }
  }
  const edges = new Map<string, GEdge>();
  const degree = new Map<string, number>();
  for (const e of g.edges) {
    edges.set(e.id, e);
    for (const end of [e.from, e.to]) {
      if (!nodes.has(end)) p.push({ msg: `Edge ${e.id} points at missing node ${end}`, edge: e.id });
      degree.set(end, (degree.get(end) ?? 0) + 1);
    }
    if (!e.evidence?.length && !e.inferred) p.push({ msg: `Edge ${e.id}: no evidence (mark it inferred or add evidence)`, edge: e.id });
  }
  for (const n of g.nodes) {
    if (!degree.get(n.id)) p.push({ msg: `${n.label}: not connected to anything`, node: n.id });
  }
  for (const f of g.flows) {
    if (!START_KINDS.has(nodes.get(f.trigger)?.kind ?? "")) p.push({ msg: `Flow "${f.name}": trigger must be an entry point, trigger or UI node`, flow: f.id });
    if (f.steps[0]?.node !== f.trigger) p.push({ msg: `Flow "${f.name}": step 1 must be the trigger`, flow: f.id });
    const seen = new Set<string>();
    f.steps.forEach((s, i) => {
      if (i > 0 && s.action && !s.edge) {
        if (s.node !== f.steps[i - 1].node) p.push({ msg: `Flow "${f.name}" step ${i + 1}: an action must stay on the same screen`, flow: f.id });
      } else if (i > 0) {
        const e = s.edge ? edges.get(s.edge) : undefined;
        if (!e) p.push({ msg: `Flow "${f.name}" step ${i + 1}: no edge`, flow: f.id });
        else if (e.to !== s.node) p.push({ msg: `Flow "${f.name}" step ${i + 1}: edge does not lead to this node`, flow: f.id });
        else if (!seen.has(e.from)) p.push({ msg: `Flow "${f.name}" step ${i + 1}: edge starts at a node the flow has not reached`, flow: f.id });
      }
      seen.add(s.node);
    });
  }
  return p;
}

export function stepProblems(g: Graph, flowId: string): Map<number, string> {
  const f = g.flows.find((x) => x.id === flowId);
  const out = new Map<number, string>();
  if (!f) return out;
  const edges = new Map(g.edges.map((e) => [e.id, e]));
  const seen = new Set<string>();
  f.steps.forEach((s, i) => {
    if (i === 0 && s.node !== f.trigger) out.set(i, "must be the trigger");
    if (i > 0 && s.action && !s.edge) {
      if (s.node !== f.steps[i - 1].node) out.set(i, "an action must stay on the same screen");
    } else if (i > 0) {
      const e = s.edge ? edges.get(s.edge) : undefined;
      if (!e) out.set(i, "no edge");
      else if (e.to !== s.node) out.set(i, "edge does not lead here");
      else if (!seen.has(e.from)) out.set(i, "edge starts at an unreached node");
    }
    seen.add(s.node);
  });
  return out;
}

/** Fresh id that does not collide with existing ones. */
export function freshId(prefix: string, taken: Iterable<string>) {
  const set = new Set(taken);
  for (let i = 1; ; i++) if (!set.has(`${prefix}${i}`)) return `${prefix}${i}`;
}
