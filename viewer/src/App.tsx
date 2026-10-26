import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type Node,
} from "@xyflow/react";
import { edgeTypes, type EdgeData } from "./edges";
import { Icon, iconFor } from "./icons";
import { layoutGraph, visualOf, type Placed } from "./layout";
import { nodeTypes, type NodeData } from "./nodes";
import type { Evidence, Flow, GEdge, GNode, Graph } from "./types";

const STEP_MS = 1700;

function evText(e?: Evidence) {
  if (!e) return "";
  if (e.file) return `${e.file}:${e.line}`;
  return e.req ?? e.screen ?? e.section ?? "";
}

function loadTheme(): "dark" | "light" {
  try {
    return (localStorage.getItem("flowmap-theme") as "dark" | "light") || "dark";
  } catch {
    return "dark";
  }
}

export default function App({ graph }: { graph: Graph }) {
  return (
    <ReactFlowProvider>
      <Viewer graph={graph} />
    </ReactFlowProvider>
  );
}

function Viewer({ graph }: { graph: Graph }) {
  const rf = useReactFlow();
  const [theme, setTheme] = useState<"dark" | "light">(loadTheme);
  const [pos, setPos] = useState<Map<string, Placed> | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ e: GEdge; x: number; y: number } | null>(null);
  const stepListRef = useRef<HTMLOListElement>(null);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph]);
  const flow: Flow | undefined = graph.flows.find((f) => f.id === flowId);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("flowmap-theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  useEffect(() => {
    layoutGraph(graph).then(setPos);
  }, [graph]);

  // Playback
  useEffect(() => {
    if (!playing || !flow) return;
    if (step >= flow.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => goTo(step + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, step, flow]);

  const goTo = useCallback(
    (i: number) => {
      if (!flow) return;
      const s = Math.max(0, Math.min(flow.steps.length - 1, i));
      setStep(s);
      setAnimKey((k) => k + 1);
      const p = pos?.get(flow.steps[s].node);
      if (p) rf.setCenter(p.x + p.w / 2, p.y + p.h / 2, { zoom: rf.getZoom(), duration: 500 });
    },
    [flow, pos, rf],
  );

  useEffect(() => {
    const li = stepListRef.current?.children[step] as HTMLElement | undefined;
    li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step, flowId]);

  const selectFlow = (id: string | null) => {
    setFlowId(id);
    setStep(0);
    setPlaying(false);
    setAnimKey((k) => k + 1);
    if (id) {
      const f = graph.flows.find((x) => x.id === id)!;
      const ids = [...new Set(f.steps.map((s) => s.node))].map((n) => ({ id: n }));
      setTimeout(() => rf.fitView({ nodes: ids, padding: 0.25, duration: 500 }), 0);
    }
  };

  // Keyboard: space play/pause, arrows step, Esc clears.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).tagName === "INPUT") return;
      if (ev.key === "Escape") {
        setSelected(null);
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

  const flowNodes = useMemo(() => new Set(flow?.steps.map((s) => s.node)), [flow]);
  const flowEdges = useMemo(() => new Set(flow?.steps.map((s) => s.edge).filter(Boolean) as string[]), [flow]);
  const curStep = flow?.steps[step];

  const [hasOut, hasIn, outCount] = useMemo(() => {
    const o = new Set<string>(), i = new Set<string>(), n = new Map<string, number>();
    for (const e of graph.edges) {
      if (e.kind !== "main") continue;
      o.add(e.from);
      i.add(e.to);
      n.set(e.from, (n.get(e.from) ?? 0) + 1);
    }
    return [o, i, n] as const;
  }, [graph]);

  const nodes: Node[] = useMemo(() => {
    if (!pos) return [];
    return graph.nodes.flatMap((n) => {
      const p = pos.get(n.id);
      if (!p) return [];
      const data: NodeData = {
        g: n, w: p.w, h: p.h, hasOut: hasOut.has(n.id), hasIn: hasIn.has(n.id),
        dim: !!flow && !flowNodes.has(n.id),
        inFlow: !!flow && flowNodes.has(n.id),
        current: curStep?.node === n.id,
        selected: selected === n.id,
      };
      return [{ id: n.id, type: visualOf(n), position: { x: p.x, y: p.y }, data, width: p.w, height: p.h }];
    });
  }, [graph, pos, flow, flowNodes, curStep, selected, hasOut, hasIn]);

  const edges: Edge[] = useMemo(() => {
    return graph.edges.map((e) => {
      const src = byId.get(e.from)!;
      const tgt = byId.get(e.to)!;
      const dep = e.kind === "dependency";
      const sourceHandle = dep ? (e.port ? `port-${e.port}` : "bottom") : "out";
      const targetHandle = dep ? "top" : "in";
      const inFlow = !!flow && flowEdges.has(e.id);
      const current = curStep?.edge === e.id;
      const dim = !!flow && !inFlow;
      const deact = src.status === "deactivated" || tgt.status === "deactivated";
      const color = current ? "var(--accent)" : inFlow ? "var(--edge-active)" : "var(--edge)";
      const cross = dep && !(tgt.hub === src.id);
      const fanOut = (outCount.get(e.from) ?? 0) > 1;
      const data: EdgeData = { g: e, dim: dim || deact, inFlow, current, cross, fanOut, animKey, showLabels: true };
      return {
        id: e.id, source: e.from, target: e.to, sourceHandle, targetHandle, type: "flow", data,
        markerEnd: dep ? undefined : { type: MarkerType.ArrowClosed, width: 16, height: 16, color: cssColor(color) },
        zIndex: inFlow ? 5 : 0,
      };
    });
  }, [graph, byId, flow, flowEdges, curStep, animKey, outCount]);

  const sel = selected ? byId.get(selected) : undefined;

  return (
    <div className="fm-app">
      <header className="fm-top">
        <div className="fm-brand">
          <span className="fm-logo"><Icon name="bolt" size={14} stroke={2.4} /></span>
          flowmap
        </div>
        <div className="fm-project">
          <strong>{graph.project.name}</strong>
          <span className="fm-chip">{graph.mode === "code" ? "Code architecture" : "Platform flow"}</span>
        </div>
        <div className="fm-stats">
          <span>{graph.nodes.length} nodes</span>
          <span>{graph.edges.length} edges</span>
          <span>{graph.flows.length} {graph.mode === "code" ? "flows" : "journeys"}</span>
        </div>
        <div className="fm-top-actions">
          <button className="fm-btn" onClick={() => rf.fitView({ padding: 0.15, duration: 400 })} title="Fit to view">
            <Icon name="fit" size={16} />
          </button>
          <button className="fm-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
        </div>
      </header>

      <aside className="fm-left">
        <div className="fm-section-title">{graph.mode === "code" ? "Flows" : "Journeys"}</div>
        <ul className="fm-flow-list">
          {graph.flows.map((f) => (
            <li key={f.id} className={f.id === flowId ? "is-active" : ""} onClick={() => selectFlow(f.id === flowId ? null : f.id)}>
              <span className="fm-flow-bolt"><Icon name="bolt" size={12} stroke={2.4} /></span>
              <div>
                <div className="fm-flow-name">{f.name}</div>
                <div className="fm-flow-meta">
                  {f.kind && <span className={`fm-kind k-${f.kind}`}>{f.kind.replace("_", " ")}</span>}
                  {f.actor && <span>{f.actor}</span>}
                  <span>{f.steps.length} steps</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {flow && (
          <div className="fm-player">
            <div className="fm-player-controls">
              <button className="fm-btn" onClick={() => goTo(0)} title="Restart"><Icon name="reset" size={15} /></button>
              <button className="fm-btn" onClick={() => goTo(step - 1)} title="Previous step (←)"><Icon name="prev" size={15} /></button>
              <button className="fm-btn fm-btn-primary" onClick={() => {
                if (!playing && step >= flow.steps.length - 1) goTo(0);
                setPlaying(!playing);
              }} title="Play / pause (space)">
                <Icon name={playing ? "pause" : "play"} size={15} />
              </button>
              <button className="fm-btn" onClick={() => goTo(step + 1)} title="Next step (→)"><Icon name="next" size={15} /></button>
              <span className="fm-step-count">{step + 1} / {flow.steps.length}</span>
            </div>
            {flow.description && <p className="fm-flow-desc">{flow.description}</p>}
            <ol className="fm-steps" ref={stepListRef}>
              {flow.steps.map((s, i) => (
                <li key={i} className={i === step ? "is-current" : i < step ? "is-done" : ""} onClick={() => goTo(i)}>
                  <span className="fm-step-n">{i + 1}</span>
                  <div>
                    <div className="fm-step-node">{byId.get(s.node)?.label}</div>
                    <div className="fm-step-desc">{s.description}</div>
                    {s.evidence && <code className="fm-ev">{evText(s.evidence)}</code>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>

      <main className="fm-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.1}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setSelected(n.id)}
          onPaneClick={() => setSelected(null)}
          onEdgeMouseEnter={(ev, e) => setHover({ e: edgeById.get(e.id)!, x: ev.clientX, y: ev.clientY })}
          onEdgeMouseMove={(ev, e) => setHover({ e: edgeById.get(e.id)!, x: ev.clientX, y: ev.clientY })}
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
      </main>

      {sel && <Drawer n={sel} graph={graph} byId={byId} onClose={() => setSelected(null)} onPick={setSelected} onFlow={selectFlow} />}
      {hover && <EdgeTip h={hover} byId={byId} />}
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

function Badge({ c }: { c?: string }) {
  const v = c ?? "high";
  return <span className={`fm-conf c-${v}`}>{v} confidence</span>;
}

function Drawer({ n, graph, byId, onClose, onPick, onFlow }: {
  n: GNode; graph: Graph; byId: Map<string, GNode>; onClose: () => void; onPick: (id: string) => void; onFlow: (id: string) => void;
}) {
  const inbound = graph.edges.filter((e) => e.to === n.id);
  const outbound = graph.edges.filter((e) => e.from === n.id);
  const flows = graph.flows.filter((f) => f.steps.some((s) => s.node === n.id));
  const { icon, color } = iconFor(n);
  const edgeRow = (e: GEdge, other: string, dir: "in" | "out") => (
    <li key={e.id} onClick={() => onPick(other)}>
      <span className="fm-dir">{dir === "in" ? "←" : "→"}</span>
      <span className="fm-edge-other">{byId.get(other)?.label}</span>
      <span className="fm-edge-meta">{[e.label, e.mechanism, e.sync === "async" ? "async" : "", e.kind === "dependency" ? "dep" : ""].filter(Boolean).join(" · ")}</span>
    </li>
  );
  return (
    <aside className="fm-drawer">
      <div className="fm-drawer-head">
        <span className="fm-drawer-icon" style={{ color }}><Icon name={icon} size={22} /></span>
        <div>
          <div className="fm-drawer-title">{n.label}{n.status === "deactivated" && <span className="fm-deact-tag"> (Deactivated)</span>}</div>
          {n.subtitle && <div className="fm-drawer-sub">{n.subtitle}</div>}
        </div>
        <button className="fm-btn fm-close" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="fm-badges">
        <span className="fm-chip">{n.kind}</span>
        {n.tech && <span className="fm-chip">{n.tech}</span>}
        {n.layer && <span className="fm-chip">{graph.layers?.find((l) => l.id === n.layer)?.label ?? n.layer}</span>}
        <Badge c={n.confidence} />
      </div>
      {n.summary && <p className="fm-summary">{n.summary}</p>}
      {!!n.evidence?.length && (
        <>
          <div className="fm-section-title">Evidence</div>
          <ul className="fm-ev-list">
            {n.evidence.map((e, i) => (
              <li key={i}><code className="fm-ev">{evText(e)}</code>{e.note && <span> {e.note}</span>}</li>
            ))}
          </ul>
        </>
      )}
      {!!n.symbols?.length && (
        <>
          <div className="fm-section-title">Key symbols</div>
          <div className="fm-symbols">{n.symbols.map((s) => <code key={s}>{s}</code>)}</div>
        </>
      )}
      {!!n.files?.length && (
        <>
          <div className="fm-section-title">Files</div>
          <ul className="fm-files">{n.files.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </>
      )}
      <div className="fm-section-title">Inbound ({inbound.length})</div>
      <ul className="fm-edge-list">{inbound.map((e) => edgeRow(e, e.from, "in"))}</ul>
      <div className="fm-section-title">Outbound ({outbound.length})</div>
      <ul className="fm-edge-list">{outbound.map((e) => edgeRow(e, e.to, "out"))}</ul>
      <div className="fm-section-title">Flows through here ({flows.length})</div>
      <ul className="fm-edge-list">
        {flows.map((f) => (
          <li key={f.id} onClick={() => onFlow(f.id)}><span className="fm-dir">⚡</span><span className="fm-edge-other">{f.name}</span></li>
        ))}
      </ul>
    </aside>
  );
}

function EdgeTip({ h, byId }: { h: { e: GEdge; x: number; y: number }; byId: Map<string, GNode> }) {
  const e = h.e;
  const left = Math.min(h.x + 14, window.innerWidth - 340);
  const top = Math.min(h.y + 14, window.innerHeight - 220);
  return (
    <div className="fm-tip" style={{ left, top }}>
      <div className="fm-tip-title">
        {byId.get(e.from)?.label} <span className="fm-dir">→</span> {byId.get(e.to)?.label}
      </div>
      <div className="fm-tip-row">
        <span className="fm-chip">{e.mechanism}</span>
        <span className="fm-chip">{e.sync ?? "sync"}</span>
        <span className="fm-chip">{e.kind}</span>
        {e.inferred && <span className="fm-chip c-low">inferred</span>}
        <Badge c={e.confidence} />
      </div>
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
