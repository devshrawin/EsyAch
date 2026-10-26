import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useStore,
  type Connection, type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import { edgeTypes, type EdgeData } from "./edges";
import {
  buildHTML, download, printBook, renderSVG, slug, svgToPng, toJSON, toMermaid, type REdge, type RNode,
} from "./export";
import { Icon, iconFor } from "./icons";
import { layoutGraph, layoutKey, visualOf, withManual, type Placed } from "./layout";
import {
  AUTO_COLLAPSE_MIN, buildView, checkGraph, freshId, groupsOf, stepProblems, type ViewGraph, type ViewOpts,
} from "./model";
import { nodeTypes, type NodeData } from "./nodes";
import { Badge, EdgeDrawer, evText, FlowsTab, Menu, NodeDrawer, SearchPalette, ViewTab } from "./panels";
import { assetSrc, badges, coverage } from "./coverage";
import { Lightbox } from "./Lightbox";
import { CoverageTab, RequirementsTab } from "./specpanels";
import { printSpecBook } from "./export";
import type { Flow, GEdge, GNode, Graph } from "./types";

const STEP_MS = 1700;
const START_KINDS = new Set(["entrypoint", "trigger", "ui", "screen"]);

function store<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------ undo history

interface Hist { past: Graph[]; present: Graph; future: Graph[] }

function useHistory(initial: Graph) {
  const [h, setH] = useState<Hist>({ past: [], present: initial, future: [] });
  const commit = useCallback((fn: (g: Graph) => void) => {
    setH((s) => {
      const next = structuredClone(s.present);
      fn(next);
      return { past: [...s.past.slice(-199), s.present], present: next, future: [] };
    });
  }, []);
  const undo = useCallback(() => setH((s) => s.past.length
    ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s), []);
  const redo = useCallback(() => setH((s) => s.future.length
    ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s), []);
  const reset = useCallback((g: Graph) => setH({ past: [], present: g, future: [] }), []);
  return { graph: h.present, canUndo: h.past.length > 0, canRedo: h.future.length > 0, commit, undo, redo, reset };
}

export default function App({ graph }: { graph: Graph }) {
  return (
    <ReactFlowProvider>
      <Viewer initial={graph} />
    </ReactFlowProvider>
  );
}

type Sel = { type: "node" | "edge"; id: string } | null;

function Viewer({ initial }: { initial: Graph }) {
  const rf = useReactFlow();
  const { graph, commit, undo, redo, reset, canUndo, canRedo } = useHistory(initial);
  const [saved, setSaved] = useState<Graph>(initial);
  const dirty = graph !== saved;
  const draftKey = `flowmap-draft:${initial.project.name}:${initial.project.generated_at ?? ""}`;
  const [draft, setDraft] = useState<{ at: string; graph: Graph } | null>(() =>
    store(() => JSON.parse(localStorage.getItem(draftKey) ?? "null"), null));

  const [theme, setTheme] = useState<"dark" | "light">(() => store(() => (localStorage.getItem("flowmap-theme") as "dark" | "light") || "dark", "dark"));
  const [editMode, setEditMode] = useState(false);
  const [tab, setTab] = useState<"flows" | "view" | "reqs" | "coverage">("flows");
  const [reqFocus, setReqFocus] = useState<string | null>(null);
  const [lb, setLb] = useState<{ s: string; v?: string } | null>(null);
  const { groups, groupOf } = useMemo(() => groupsOf(graph), [graph]);
  const [opts, setOpts] = useState<ViewOpts>(() => ({
    level: initial.nodes.length > 80 ? "structure" : "detail",
    hiddenKinds: new Set(), hiddenLayers: new Set(), showDeps: true, showDeactivated: true, showGlobal: false, actor: null,
    collapsed: initial.nodes.length > AUTO_COLLAPSE_MIN ? new Set(groupsOf(initial).groups.map((g) => g.id)) : new Set(),
  }));
  const [auto, setAuto] = useState<Map<string, Placed> | null>(null);
  const [drag, setDrag] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [flowId, setFlowId] = useState<string | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<{ e: GEdge; x: number; y: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const stepListRef = useRef<HTMLOListElement>(null);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 3200);
  };

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const flow: Flow | undefined = graph.flows.find((f) => f.id === flowId);
  const keepEdges = useMemo(() => new Set(flow?.steps.map((s) => s.edge).filter(Boolean) as string[]), [flow]);
  const view: ViewGraph = useMemo(() => buildView(graph, opts, keepEdges), [graph, opts, keepEdges]);
  const isSpec = graph.mode === "spec";
  const cov = useMemo(() => (isSpec ? coverage(graph) : null), [graph, isSpec]);
  const badgeMap = useMemo(() => (cov ? badges(cov) : new Map<string, { sev: "red" | "amber"; text: string }[]>()), [cov]);
  const viewEdgeById = useMemo(() => new Map(view.edges.map((e) => [e.id, e])), [view]);
  const problems = useMemo(() => checkGraph(graph), [graph]);
  const stepBad = useMemo(() => (flowId ? stepProblems(graph, flowId) : new Map<number, string>()), [graph, flowId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store(() => localStorage.setItem("flowmap-theme", theme), undefined);
  }, [theme]);

  // Draft autosave: unsaved edits survive a reload of the same file.
  useEffect(() => {
    if (dirty) store(() => localStorage.setItem(draftKey, JSON.stringify({ at: new Date().toISOString(), graph })), undefined);
    else store(() => localStorage.removeItem(draftKey), undefined);
  }, [graph, dirty, draftKey]);

  // Layout. In edit mode an added node already has a position, so we keep everything where it
  // is instead of re-running ELK (which would move nodes the user is looking at).
  // Global navigation edges (header links) never move nodes: they are left out of the layout.
  const key = useMemo(() => layoutKey({ ...graph, nodes: view.nodes, edges: view.edges.filter((e) => !e.global) }), [view, graph]);
  const laidKey = useRef<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [relayoutTick, setRelayoutTick] = useState(0);
  useEffect(() => {
    if (laidKey.current === key && relayoutTick === 0) return;
    const v = viewRef.current;
    const missing = !auto || v.nodes.some((n) => !auto.has(n.id) && !n.pos);
    if (editMode && !missing && relayoutTick === 0) {
      laidKey.current = key;
      return;
    }
    let live = true;
    layoutGraph({ ...graph, nodes: v.nodes, edges: v.edges.filter((e) => !e.global) }).then((p) => {
      if (!live) return;
      const first = laidKey.current === null;
      laidKey.current = key;
      setAuto(p);
      setRelayoutTick(0);
      // A different structure (level, groups, filters) gets re-fitted; the first fit is ReactFlow's own.
      if (!first) setTimeout(() => rf.fitView({ padding: 0.15, duration: 400 }), 50);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, relayoutTick]);

  const pos = useMemo(() => (auto ? withManual(auto, view.nodes, drag) : null), [auto, view, drag]);

  // Flow highlight, mapped through the view (collapsed/folded nodes stand in for their members).
  const vNode = (id?: string) => (id ? view.nodeMap.get(id) : undefined);
  const vEdge = (id?: string) => (id ? view.edgeMap.get(id) : undefined);
  const flowNodes = useMemo(() => new Set(flow?.steps.map((s) => view.nodeMap.get(s.node)).filter(Boolean) as string[]), [flow, view]);
  const flowEdges = useMemo(() => new Set(flow?.steps.map((s) => (s.edge ? view.edgeMap.get(s.edge) : undefined)).filter(Boolean) as string[]), [flow, view]);
  const curStep = flow?.steps[step];
  const reqNodes = useMemo(() => new Set(reqFocus && cov ? (cov.reqScreens.get(reqFocus) ?? []).map((id) => view.nodeMap.get(id)).filter(Boolean) as string[] : []), [reqFocus, cov, view]);
  const reqEdgeSet = useMemo(() => new Set(reqFocus && cov ? (cov.reqEdges.get(reqFocus) ?? []).map((id) => view.edgeMap.get(id)).filter(Boolean) as string[] : []), [reqFocus, cov, view]);
  const focusOn = !flow && !!reqFocus;
  const curNode = vNode(curStep?.node);
  const curEdge = vEdge(curStep?.edge);

  const goTo = useCallback((i: number) => {
    if (!flow) return;
    const s = Math.max(0, Math.min(flow.steps.length - 1, i));
    setStep(s);
    setAnimKey((k) => k + 1);
    const id = view.nodeMap.get(flow.steps[s].node);
    const p = id ? pos?.get(id) : undefined;
    if (p) rf.setCenter(p.x + p.w / 2, p.y + p.h / 2, { zoom: rf.getZoom(), duration: 500 });
  }, [flow, pos, rf, view]);

  useEffect(() => {
    if (!playing || !flow) return;
    if (step >= flow.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => goTo(step + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, step, flow, goTo]);

  useEffect(() => {
    const li = stepListRef.current?.children[step] as HTMLElement | undefined;
    li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step, flowId]);

  const selectFlow = (id: string | null, keepTab = false) => {
    setFlowId(id);
    if (id) setReqFocus(null);
    setStep(0);
    setPlaying(false);
    setAnimKey((k) => k + 1);
    if (!keepTab) setTab("flows");
    if (id) {
      const f = graph.flows.find((x) => x.id === id);
      if (!f) return;
      const ids = [...new Set(f.steps.map((s) => view.nodeMap.get(s.node)).filter(Boolean) as string[])].map((n) => ({ id: n }));
      setTimeout(() => rf.fitView({ nodes: ids, padding: 0.25, duration: 500, maxZoom: 1.2 }), 0);
    }
  };

  // Bring a node into view: expand its group / clear filters hiding it, then center once laid out.
  const reveal = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    setOpts((o) => {
      const gid = groupOf.get(id);
      const collapsed = new Set(o.collapsed);
      if (gid) collapsed.delete(gid);
      const hiddenKinds = new Set(o.hiddenKinds);
      hiddenKinds.delete(n.kind);
      const hiddenLayers = new Set(o.hiddenLayers);
      if (n.layer) hiddenLayers.delete(n.layer);
      const level = o.level === "overview" && n.hub ? "structure" : o.level;
      return { ...o, collapsed, hiddenKinds, hiddenLayers, level, showDeactivated: o.showDeactivated || n.status === "deactivated" };
    });
    setSel({ type: "node", id });
    setFocusId(id);
  };
  useEffect(() => {
    if (!focusId || !pos) return;
    const p = pos.get(focusId);
    if (!p) return;
    rf.setCenter(p.x + p.w / 2, p.y + p.h / 2, { zoom: Math.max(rf.getZoom(), 1), duration: 500 });
    setFocusId(null);
  }, [focusId, pos, rf]);

  // ------------------------------------------------------------------ editing

  const edit = commit;

  const deleteNode = (id: string) => {
    const goneEdges = new Set(graph.edges.filter((e) => e.from === id || e.to === id).map((e) => e.id));
    const removedSteps = graph.flows.reduce((k, f) => k + f.steps.filter((s) => s.node === id || (s.edge && goneEdges.has(s.edge))).length, 0);
    edit((g) => {
      g.nodes = g.nodes.filter((n) => n.id !== id);
      for (const n of g.nodes) if (n.hub === id) { delete n.hub; delete n.port; }
      g.edges = g.edges.filter((e) => !goneEdges.has(e.id));
      for (const f of g.flows) f.steps = f.steps.filter((s) => s.node !== id && !(s.edge && goneEdges.has(s.edge)));
    });
    setSel(null);
    say(`Node deleted${removedSteps ? `; ${removedSteps} flow step(s) that used it were removed` : ""}. Ctrl+Z undoes.`);
  };
  const deleteEdge = (id: string) => {
    edit((g) => {
      g.edges = g.edges.filter((e) => e.id !== id);
      for (const f of g.flows) f.steps = f.steps.filter((s, i) => i === 0 || s.edge !== id);
    });
    setSel(null);
    say("Edge deleted. Ctrl+Z undoes.");
  };
  const addNode = () => {
    const el = document.querySelector(".fm-canvas")!.getBoundingClientRect();
    const p = rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 });
    const id = freshId("n_user_", graph.nodes.map((n) => n.id));
    edit((g) => {
      g.nodes.push({
        id, label: "New node", kind: "module", confidence: "med", status: "active", edited: true,
        evidence: [{ user: true, note: "added in editor" }], pos: { x: Math.round(p.x - 32), y: Math.round(p.y - 32) },
      });
    });
    setSel({ type: "node", id });
    say("Node added. Drag from its right dot to another node's left bar to connect it.");
  };
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target || !byId.has(c.source) || !byId.has(c.target)) return;
    const dep = (c.sourceHandle ?? "").startsWith("port-") || c.sourceHandle === "bottom" || c.targetHandle === "top";
    const id = freshId("e_user_", graph.edges.map((e) => e.id));
    edit((g) => {
      g.edges.push({
        id, from: c.source!, to: c.target!, kind: dep ? "dependency" : "main", mechanism: "call", sync: "sync",
        ...(c.sourceHandle?.startsWith("port-") ? { port: c.sourceHandle.slice(5) } : {}),
        confidence: "med", edited: true, evidence: [{ user: true, note: "added in editor" }],
      });
    });
    setSel({ type: "edge", id });
  };
  const dragRef = useRef(new Map<string, { x: number; y: number }>());
  const onNodesChange = (changes: NodeChange[]) => {
    if (!editMode) return;
    for (const ch of changes) {
      if (ch.type !== "position") continue;
      if (ch.dragging && ch.position) {
        dragRef.current.set(ch.id, ch.position);
      } else if (ch.dragging === false) {
        const p = dragRef.current.get(ch.id);
        dragRef.current.delete(ch.id);
        if (p && byId.has(ch.id)) {
          edit((g) => {
            const n = g.nodes.find((x) => x.id === ch.id);
            if (n) n.pos = { x: Math.round(p.x), y: Math.round(p.y) };
          });
        }
      }
    }
    setDrag(new Map(dragRef.current));
  };
  const newFlow = () => {
    const cand = sel?.type === "node" && START_KINDS.has(byId.get(sel.id)?.kind ?? "") ? sel.id : graph.nodes.find((n) => START_KINDS.has(n.kind))?.id;
    if (!cand) {
      say("A flow must start at an entry point, trigger or UI node. Add one first.");
      return;
    }
    const id = freshId("flow_", graph.flows.map((f) => f.id));
    edit((g) => {
      g.flows.push({ id, name: "New flow", kind: "happy", trigger: cand, edited: true, steps: [{ node: cand, description: "Starts here" }] });
    });
    selectFlow(id);
    setRecording(true);
    say("New flow: click edges on the canvas to add steps (Record is on).");
  };
  const appendStep = (edgeId: string) => {
    const e = graph.edges.find((x) => x.id === edgeId);
    if (!e || !flow) return;
    if (!flow.steps.some((s) => s.node === e.from)) {
      say(`That edge starts at "${byId.get(e.from)?.label}", which this flow has not reached yet.`);
      return;
    }
    edit((g) => {
      const f = g.flows.find((x) => x.id === flow.id)!;
      f.steps.push({ node: e.to, edge: e.id, description: e.label ?? "" });
      f.edited = true;
    });
    setStep(flow.steps.length);
  };

  // ------------------------------------------------------------------ save & export

  const fileBase = graph.mode === "spec" ? "screens" : "architecture";
  const saveJSON = async () => {
    const text = toJSON(graph);
    type Picker = (o: object) => Promise<{ createWritable: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }> }>;
    const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
    if (picker) {
      try {
        const h = await picker({ suggestedName: `${fileBase}.json`, types: [{ description: "flowmap JSON", accept: { "application/json": [".json"] } }] });
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
        setSaved(graph);
        say("Saved. Run /flowmap-update to rebuild the HTML from it.");
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    download(`${fileBase}.json`, text, "application/json");
    setSaved(graph);
    say(`Downloaded ${fileBase}.json. Put it in .flowmap/ and run /flowmap-update.`);
  };
  const saveHTML = () => {
    const html = buildHTML(graph);
    if (!html) {
      say("HTML export needs the built file (not the dev server).");
      return;
    }
    download(`${slug(graph.project.name)}.flowmap.html`, html, "text/html");
    setSaved(graph);
    say("Downloaded a self-contained HTML with your edits.");
  };

  const renderState = (f?: Flow): { nodes: RNode[]; edges: REdge[] } => {
    if (!pos) return { nodes: [], edges: [] };
    const fN = new Set(f?.steps.map((s) => view.nodeMap.get(s.node)).filter(Boolean) as string[]);
    const fE = new Set(f?.steps.map((s) => (s.edge ? view.edgeMap.get(s.edge) : undefined)).filter(Boolean) as string[]);
    const outs = new Set(view.edges.filter((e) => e.kind === "main").map((e) => e.from));
    const nodes = view.nodes.flatMap((n) => {
      const p = pos.get(n.id);
      return p ? [{ n, p, v: visualOf(n), dim: !!f && !fN.has(n.id), inFlow: !!f && fN.has(n.id), current: false, hasOut: outs.has(n.id), badges: badgeMap.get(n.id) }] : [];
    });
    const vb = new Map(view.nodes.map((n) => [n.id, n]));
    const edges = view.edges.map((e) => ({
      e, dim: !!f && !fE.has(e.id), inFlow: !!f && fE.has(e.id), current: false,
      cross: e.kind === "dependency" && vb.get(e.to)?.hub !== e.from, fanOut: (outCount.get(e.from) ?? 0) > 1,
    }));
    return { nodes, edges };
  };
  const exportImage = async (kind: "svg" | "png") => {
    const st = renderState(flow);
    const title = `${graph.project.name}${flow ? ` · ${flow.name}` : ""}`;
    const { svg, width, height } = renderSVG(st.nodes, st.edges, { payloads: opts.level === "detail", title, assets: graph.assets });
    const name = `${slug(graph.project.name)}${flow ? "-" + slug(flow.name) : ""}`;
    if (kind === "svg") download(`${name}.svg`, svg, "image/svg+xml");
    else download(`${name}.png`, await svgToPng(svg, width, height, 2));
  };
  const exportPrototype = () => {
    const start = cov?.entries[0] ?? graph.nodes.find((n) => n.kind === "screen")?.id;
    const html = buildHTML({ ...graph, view: { prototype: true, start } });
    if (!html) return say("Prototype export needs the built file (not the dev server).");
    download(`${slug(graph.project.name)}.prototype.html`, html, "text/html");
  };
  const exportPrint = () => {
    if (isSpec && cov) {
      const all = renderState();
      printSpecBook(graph, cov, renderSVG(all.nodes, all.edges, { payloads: false, assets: graph.assets }).svg);
      return;
    }
    const all = renderState();
    const overview = renderSVG(all.nodes, all.edges, { payloads: false }).svg;
    const per = graph.flows.map((f) => {
      const st = renderState(f);
      return { flow: f, svg: renderSVG(st.nodes, st.edges, { payloads: false }).svg };
    });
    printBook(graph, overview, per);
  };

  // ------------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((ev.target as HTMLElement).tagName);
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (typing) return;
      if (lb && (ev.key === "Delete" || ev.key === "Backspace")) return;
      if (mod && ev.key.toLowerCase() === "z" && editMode) {
        ev.preventDefault();
        if (ev.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && ev.key.toLowerCase() === "y" && editMode) {
        ev.preventDefault();
        redo();
        return;
      }
      if (mod && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        saveJSON();
        return;
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && editMode && sel) {
        ev.preventDefault();
        if (sel.type === "node" && byId.has(sel.id)) deleteNode(sel.id);
        else if (sel.type === "edge" && graph.edges.some((e) => e.id === sel.id)) deleteEdge(sel.id);
        return;
      }
      if (ev.key === "Escape") {
        if (lb) { setLb(null); return; }
        setSel(null);
        setReqFocus(null);
        selectFlow(null);
      }
      if (!flow) return;
      if (ev.key === " ") {
        ev.preventDefault();
        setPlaying((p) => !p);
      } else if (ev.key === "ArrowRight") goTo(step + 1);
      else if (ev.key === "ArrowLeft") goTo(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ------------------------------------------------------------------ xyflow nodes/edges

  const [hasOut, hasIn, outCount] = useMemo(() => {
    const o = new Set<string>(), i = new Set<string>(), n = new Map<string, number>();
    for (const e of view.edges) {
      if (e.kind !== "main") continue;
      o.add(e.from);
      i.add(e.to);
      n.set(e.from, (n.get(e.from) ?? 0) + 1);
    }
    return [o, i, n] as const;
  }, [view]);

  const nodes: Node[] = useMemo(() => {
    if (!pos) return [];
    return view.nodes.flatMap((n) => {
      const p = pos.get(n.id);
      if (!p) return [];
      const data: NodeData = {
        g: n, w: p.w, h: p.h, hasOut: hasOut.has(n.id), hasIn: hasIn.has(n.id),
        dim: (!!flow && !flowNodes.has(n.id)) || (focusOn && !reqNodes.has(n.id)),
        inFlow: (!!flow && flowNodes.has(n.id)) || (focusOn && reqNodes.has(n.id)),
        current: curNode === n.id,
        selected: sel?.type === "node" && sel.id === n.id,
        src: n.kind === "screen" ? assetSrc(graph, n) : undefined,
        badges: badgeMap.get(n.id),
      };
      return [{
        id: n.id, type: visualOf(n), position: { x: p.x, y: p.y }, data, width: p.w, height: p.h,
        draggable: editMode, connectable: editMode && !n.collapsedGroup,
      }];
    });
  }, [view, pos, flow, flowNodes, curNode, sel, hasOut, hasIn, editMode, focusOn, reqNodes, badgeMap, graph]);

  const vById = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view]);
  const edges: Edge[] = useMemo(() => {
    return view.edges.flatMap((e) => {
      const src = vById.get(e.from), tgt = vById.get(e.to);
      if (!src || !tgt) return [];
      const dep = e.kind === "dependency";
      const srcIsHub = visualOf(src) === "hub";
      const sourceHandle = dep ? (e.port && srcIsHub ? `port-${e.port}` : "bottom") : "out";
      const targetHandle = dep ? "top" : "in";
      const inFlow = (!!flow && flowEdges.has(e.id)) || (focusOn && reqEdgeSet.has(e.id));
      const current = curEdge === e.id;
      const dim = (!!flow || focusOn) && !inFlow;
      const deact = src.status === "deactivated" || tgt.status === "deactivated";
      const color = current ? "var(--accent)" : inFlow ? "var(--edge-active)" : "var(--edge)";
      const cross = dep && !(tgt.hub === src.id);
      const fanOut = (outCount.get(e.from) ?? 0) > 1;
      const selected = sel?.type === "edge" && sel.id === e.id;
      const data: EdgeData = {
        g: e, dim: dim || deact, inFlow, current, cross, fanOut, animKey, selected,
        showLabels: opts.level !== "overview", payloads: opts.level === "detail",
      };
      return [{
        id: e.id, source: e.from, target: e.to, sourceHandle, targetHandle, type: "flow", data,
        markerEnd: dep ? undefined : { type: MarkerType.ArrowClosed, width: 16, height: 16, color: cssColor(color) },
        zIndex: inFlow || selected ? 5 : 0,
      }];
    });
  }, [view, vById, flow, flowEdges, curEdge, animKey, outCount, sel, opts.level, theme, focusOn, reqEdgeSet]);

  const zoom = useStore((s) => s.transform[2]);
  const zoomClass = zoom < 0.22 ? "fm-zoom-far fm-zoom-mid" : zoom < 0.45 ? "fm-zoom-mid" : "";

  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groupOf.values()) m.set(g, (m.get(g) ?? 0) + 1);
    return m;
  }, [groupOf]);

  const selNode = sel?.type === "node" ? byId.get(sel.id) : undefined;
  const selEdge = sel?.type === "edge" ? graph.edges.find((e) => e.id === sel.id) ?? viewEdgeById.get(sel.id) : undefined;
  const big = view.nodes.length > 200;

  if (graph.view?.prototype && cov) {
    const start = graph.view.start ?? cov.entries[0];
    return (
      <div className="fm-proto">
        <div className="fm-proto-bar">
          <span className="fm-logo"><Icon name="bolt" size={14} stroke={2.4} /></span>
          <strong>{graph.project.name}</strong>
          <span className="fm-chip">Clickable prototype</span>
          <select className="fm-input fm-proto-journey" value={flowId ?? ""} onChange={(e) => selectFlow(e.target.value || null, true)}>
            <option value="">Explore freely</option>
            {graph.flows.map((f) => <option key={f.id} value={f.id}>Journey: {f.name}</option>)}
          </select>
        </div>
        {start && <Lightbox graph={graph} cov={cov} start={{ s: start }} editMode={false} edit={edit} prototype
          flow={flow} step={step} goTo={goTo} playing={playing} setPlaying={setPlaying} onClose={() => undefined}
          onReq={() => undefined} onShowOnCanvas={() => undefined} />}
      </div>
    );
  }

  return (
    <div className={`fm-app ${editMode ? "is-editing" : ""}`}>
      <header className="fm-top">
        <div className="fm-brand">
          <span className="fm-logo"><Icon name="bolt" size={14} stroke={2.4} /></span>
          flowmap
        </div>
        <div className="fm-project">
          <strong>{graph.project.name}</strong>
          <span className="fm-chip">{graph.mode === "code" ? "Code architecture" : "Platform flow"}</span>
          {dirty && <span className="fm-chip c-warn" title="Edits not saved yet">● unsaved</span>}
        </div>
        <div className="fm-stats">
          <span>{graph.nodes.length} nodes</span>
          <span>{graph.edges.length} edges</span>
          <span>{graph.flows.length} {graph.mode === "code" ? "flows" : "journeys"}</span>
        </div>
        <button className="fm-search-btn" onClick={() => setSearchOpen(true)} data-testid="search-btn">
          <Icon name="search" size={14} /> Search <kbd>⌘K</kbd>
        </button>
        <div className="fm-top-actions">
          <div className="fm-seg fm-mode">
            <button className={!editMode ? "is-on" : ""} onClick={() => { setEditMode(false); setRecording(false); }}>View</button>
            <button className={editMode ? "is-on" : ""} data-testid="edit-toggle" onClick={() => setEditMode(true)}>Edit</button>
          </div>
          {editMode && (
            <>
              <button className="fm-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)"><Icon name="undo" size={15} /></button>
              <button className="fm-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)"><Icon name="redo" size={15} /></button>
              <button className="fm-btn fm-btn-text" onClick={addNode} data-testid="add-node"><Icon name="plus" size={15} /> Node</button>
            </>
          )}
          <button className="fm-btn" onClick={() => setRelayoutTick((t) => t + 1)} title="Re-run auto layout (manual positions are kept)"><Icon name="layout" size={15} /></button>
          <button className={`fm-btn fm-btn-text ${problems.length ? "c-warn" : "c-ok"}`} onClick={() => setProblemsOpen(!problemsOpen)} title="Checks">
            {problems.length ? `⚠ ${problems.length}` : "✓ valid"}
          </button>
          <Menu label="Save" icon="download" testid="save-menu" items={[
            { label: `Download ${fileBase}.json`, hint: "Ctrl+S · then /flowmap-update", onClick: saveJSON },
            { label: "Download HTML with edits", hint: "self-contained, offline", onClick: saveHTML },
            "sep",
            { label: "Discard all edits", disabled: !dirty, onClick: () => { reset(saved); say("Edits discarded."); } },
          ]} />
          <Menu label="Export" icon="image" testid="export-menu" items={[
            { label: "PNG image", hint: flow ? `current view · ${flow.name}` : "current view", onClick: () => exportImage("png") },
            { label: "SVG (vector)", hint: "Figma, Inkscape, slides", onClick: () => exportImage("svg") },
            { label: "Mermaid", hint: "paste into Markdown / GitHub", onClick: () => download(`${slug(graph.project.name)}.mmd`, toMermaid(graph, flow), "text/plain") },
            { label: "JSON", hint: "graph data", onClick: () => download(`${fileBase}.json`, toJSON(graph), "application/json") },
            { label: "Interactive HTML", hint: "share this explorer", onClick: saveHTML },
            ...(isSpec ? [
              { label: "Clickable prototype (HTML)", hint: "screens + hotspots only", onClick: exportPrototype },
            ] : []),
            "sep" as const,
            { label: isSpec ? "Print / PDF flow book" : "Print / PDF", hint: isSpec ? "coverage + every journey with screenshots" : "overview + one page per flow", onClick: exportPrint },
          ]} />
          <button className="fm-btn" onClick={() => rf.fitView({ padding: 0.15, duration: 400 })} title="Fit to view"><Icon name="fit" size={16} /></button>
          <button className="fm-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
        </div>
      </header>

      <aside className="fm-left">
        <div className="fm-tabs">
          <button className={tab === "flows" ? "is-on" : ""} onClick={() => setTab("flows")}>{graph.mode === "code" ? "Flows" : "Journeys"}</button>
          {isSpec && <button className={tab === "reqs" ? "is-on" : ""} onClick={() => setTab("reqs")} data-testid="reqs-tab">Reqs</button>}
          {isSpec && cov && (
            <button className={tab === "coverage" ? "is-on" : ""} onClick={() => setTab("coverage")} data-testid="coverage-tab">
              Coverage{(cov.withoutScreen.length + cov.findings.length + cov.unreachable.length) > 0 && <span className="fm-tab-badge">{cov.withoutScreen.length + cov.findings.length + cov.unreachable.length + cov.deadEnds.length}</span>}
            </button>
          )}
          <button className={tab === "view" ? "is-on" : ""} onClick={() => setTab("view")} data-testid="view-tab">{isSpec ? "View" : "View & filters"}</button>
        </div>
        {tab === "reqs" && cov ? (
          <RequirementsTab graph={graph} cov={cov} reqFocus={reqFocus} setReqFocus={(id) => { setReqFocus(id); if (id) selectFlow(null, true); }} openScreen={(id) => setLb({ s: id })} />
        ) : tab === "coverage" && cov ? (
          <CoverageTab graph={graph} cov={cov} openScreen={(id) => setLb({ s: id })} setReqFocus={(id) => { setReqFocus(id); setTab("reqs"); }}
            selectFlow={selectFlow} showEdge={(id) => { setSel({ type: "edge", id }); setOpts((o) => ({ ...o, showGlobal: o.showGlobal || !!graph.edges.find((e) => e.id === id)?.global })); }} />
        ) : tab === "flows" ? (
          <FlowsTab graph={graph} flowId={flowId} step={step} playing={playing} editMode={editMode} edit={edit}
            stepProblems={stepBad} recording={recording} actor={actor} setActor={setActor} onSelect={selectFlow}
            goTo={goTo} setPlaying={setPlaying} setRecording={setRecording} onNewFlow={newFlow} listRef={stepListRef}
            onWalk={isSpec && flow ? () => setLb({ s: flow.steps[step].node, v: flow.steps[step].variant }) : undefined} />
        ) : (
          <ViewTab graph={graph} opts={opts} setOpts={setOpts} groups={groups} groupCounts={groupCounts} isSpec={isSpec} />
        )}
      </aside>

      <main className={`fm-canvas ${zoomClass}`}>
        {draft && JSON.stringify(draft.graph) !== JSON.stringify(graph) && (
          <div className="fm-banner">
            Unsaved edits from {new Date(draft.at).toLocaleString()} were found.
            <button className="fm-btn fm-btn-primary fm-btn-sm" onClick={() => { commit((g) => Object.assign(g, draft.graph)); setDraft(null); setEditMode(true); }}>Restore</button>
            <button className="fm-btn fm-btn-sm" onClick={() => { store(() => localStorage.removeItem(draftKey), undefined); setDraft(null); }}>Discard</button>
          </div>
        )}
        {editMode && (
          <div className="fm-edit-hint">
            Editing. Drag nodes · connect a right dot to a left bar · Del deletes · Ctrl+Z undo · Save downloads the JSON
            {recording && flow && <b> · Recording "{flow.name}": click edges to add steps</b>}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={editMode}
          nodesConnectable={editMode}
          elementsSelectable
          onlyRenderVisibleElements={big}
          minZoom={0.05}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => {
            const g = (n.data as NodeData).g;
            if (g.collapsedGroup) {
              setOpts((o) => {
                const c = new Set(o.collapsed);
                c.delete(g.collapsedGroup!);
                return { ...o, collapsed: c };
              });
              return;
            }
            if (g.kind === "screen") {
              setLb(flow && flow.steps[step]?.node === n.id ? { s: n.id, v: flow.steps[step].variant } : { s: n.id });
              return;
            }
            setSel({ type: "node", id: n.id });
          }}
          onEdgeClick={(_, e) => {
            if (editMode && recording && flow && byId.has(e.source)) appendStep(e.id);
            else setSel({ type: "edge", id: e.id });
          }}
          onPaneClick={() => setSel(null)}
          onEdgeMouseEnter={(ev, e) => setHover({ e: viewEdgeById.get(e.id)!, x: ev.clientX, y: ev.clientY })}
          onEdgeMouseMove={(ev, e) => setHover({ e: viewEdgeById.get(e.id)!, x: ev.clientX, y: ev.clientY })}
          onEdgeMouseLeave={() => setHover(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--dot)" />
          <MiniMap pannable zoomable nodeColor={(n) => miniColor(n)} maskColor="var(--minimap-mask)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {!pos && <div className="fm-loading">Laying out…</div>}
        {flow && curStep && (
          <div className="fm-caption">
            <span className="fm-caption-n">{step + 1}/{flow.steps.length}</span>
            <strong>{byId.get(curStep.node)?.label}</strong>
            <span>{curStep.description}</span>
            {curStep.payload && <code>{curStep.payload}</code>}
            {curStep.evidence && <code className="fm-ev">{evText(curStep.evidence)}</code>}
          </div>
        )}
        {problemsOpen && (
          <div className="fm-problems">
            <div className="fm-section-title fm-row"><span>Checks ({problems.length})</span>
              <button className="fm-btn fm-btn-sm" onClick={() => setProblemsOpen(false)}><Icon name="x" size={12} /></button></div>
            {!problems.length && <p className="fm-muted">No structural problems. scripts/validate.py also checks file:line evidence against the source.</p>}
            <ul>
              {problems.map((p, i) => (
                <li key={i} onClick={() => {
                  if (p.node) reveal(p.node);
                  else if (p.edge) setSel({ type: "edge", id: p.edge });
                  else if (p.flow) selectFlow(p.flow);
                }}>{p.msg}</li>
              ))}
            </ul>
          </div>
        )}
        {toast && <div className="fm-toast">{toast}</div>}
      </main>

      {selNode && (
        <NodeDrawer n={selNode} graph={graph} editMode={editMode} edit={edit} onClose={() => setSel(null)}
          onPick={reveal} onPickEdge={(id) => setSel({ type: "edge", id })} onFlow={selectFlow}
          onDelete={() => deleteNode(selNode.id)}
          groupLabel={groups.find((g) => g.id === groupOf.get(selNode.id))?.label}
          onCollapseGroup={groupOf.get(selNode.id) ? () => {
            const gid = groupOf.get(selNode.id)!;
            setOpts((o) => ({ ...o, collapsed: new Set(o.collapsed).add(gid) }));
            setSel(null);
          } : undefined} />
      )}
      {selEdge && (
        <EdgeDrawer e={selEdge} graph={graph} editMode={editMode} edit={edit} onClose={() => setSel(null)}
          onPick={reveal} onDelete={() => deleteEdge(selEdge.id)} />
      )}
      {hover && <EdgeTip h={hover} byId={byId} />}
      {lb && cov && (
        <Lightbox graph={graph} cov={cov} start={lb} editMode={editMode} edit={edit} flow={flow} step={step} goTo={goTo}
          playing={playing} setPlaying={setPlaying} onClose={() => setLb(null)}
          onReq={(id) => { setReqFocus(id); setTab("reqs"); selectFlow(null, true); setLb(null); }}
          onShowOnCanvas={(id) => { setLb(null); setFocusId(id); }} />
      )}
      {searchOpen && (
        <SearchPalette graph={graph} groups={groups} onClose={() => setSearchOpen(false)} onPick={(h) => {
          setSearchOpen(false);
          if (h.type === "node") {
            reveal(h.id);
            if (byId.get(h.id)?.kind === "screen") setLb({ s: h.id });
          } else if (h.type === "req") {
            setReqFocus(h.id);
            setTab("reqs");
            selectFlow(null, true);
          } else if (h.type === "flow") selectFlow(h.id);
          else setOpts((o) => {
            const c = new Set(o.collapsed);
            c.delete(h.id);
            return { ...o, collapsed: c };
          });
        }} />
      )}
    </div>
  );
}

function cssColor(v: string) {
  const m = v.match(/^var\((--[\w-]+)\)$/);
  if (!m) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#888";
}

function miniColor(n: Node) {
  const d = n.data as NodeData;
  if (d.current) return "#ff6d5a";
  if (d.dim) return "#44464a";
  return iconFor(d.g).color;
}

function EdgeTip({ h, byId }: { h: { e: GEdge; x: number; y: number }; byId: Map<string, GNode> }) {
  const e = h.e;
  if (!e) return null;
  const left = Math.min(h.x + 14, window.innerWidth - 340);
  const top = Math.min(h.y + 14, window.innerHeight - 220);
  return (
    <div className="fm-tip" style={{ left, top }}>
      <div className="fm-tip-title">
        {byId.get(e.from)?.label ?? e.from} <span className="fm-dir">→</span> {byId.get(e.to)?.label ?? e.to}
      </div>
      <div className="fm-tip-row">
        <span className="fm-chip">{e.mechanism}</span>
        <span className="fm-chip">{e.sync ?? "sync"}</span>
        <span className="fm-chip">{e.kind}</span>
        {e.inferred && <span className="fm-chip c-low">inferred</span>}
        {e.confirmed && <span className="fm-chip c-ok">✓ reviewed</span>}
        <Badge c={e.confidence} />
      </div>
      {e.aggregate && e.aggregate.length > 1 && <div><b>{e.aggregate.length} edges merged</b> (click for the list)</div>}
      {e.label && <div><b>Action:</b> {e.label}</div>}
      {e.payload && <div><b>Payload:</b> <code>{e.payload}</code></div>}
      {e.condition && <div><b>Condition:</b> {e.condition}</div>}
      {e.reason && <div><b>Why inferred:</b> {e.reason}</div>}
      {!!e.evidence?.length && (
        <div className="fm-tip-ev">{e.evidence.map((x, i) => <code key={i} className="fm-ev">{evText(x)}</code>)}</div>
      )}
    </div>
  );
}
