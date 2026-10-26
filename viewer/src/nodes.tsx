// n8n-style node renderers. Labels live outside the box (absolutely positioned) so the
// xyflow node size is exactly the visual box and handles sit on its edges.
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Icon, iconFor } from "./icons";
import { G, portX } from "./layout";
import type { GNode } from "./types";

export interface NodeData {
  g: GNode;
  w: number;
  h: number;
  hasOut: boolean;
  hasIn: boolean;
  dim: boolean;
  inFlow: boolean;
  current: boolean;
  selected: boolean;
  src?: string; // Mode B: embedded screenshot
  badges?: { sev: "red" | "amber"; text: string }[];
  [key: string]: unknown;
}

function cls(...xs: (string | false | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function stateClass(d: NodeData) {
  return cls(d.dim && "is-dim", d.inFlow && "in-flow", d.current && "is-current", d.selected && "is-selected",
    d.g.status === "deactivated" && "is-deact", d.g.confidence === "low" && "is-low");
}

function Reviewed({ d }: { d: NodeData }) {
  return d.g.confirmed ? <span className="fm-ok-badge" title="Reviewed by a person">✓</span> : null;
}

function Label({ d }: { d: NodeData }) {
  return (
    <div className="fm-label-wrap">
      <div className="fm-label">
        {d.g.label}
        {d.g.status === "deactivated" && <span className="fm-deact-tag"> (Deactivated)</span>}
      </div>
      {d.g.subtitle && <div className="fm-subtitle">{d.g.subtitle}</div>}
    </div>
  );
}

const hidden = "fm-handle-hidden";

function Stub() {
  return (
    <div className="fm-stub">
      <span className="fm-stub-line" />
      <span className="fm-stub-plus">+</span>
    </div>
  );
}

export function StdNode({ data }: NodeProps) {
  const d = data as NodeData;
  const { icon, color } = iconFor(d.g);
  return (
    <div className={cls("fm-node fm-std", stateClass(d))} style={{ width: d.w, height: d.h }}>
      <Handle type="target" position={Position.Left} id="in" className="fm-handle-in" />
      <Handle type="target" position={Position.Top} id="top" className={hidden} />
      <Icon name={icon} size={30} style={{ color }} />
      <Handle type="source" position={Position.Right} id="out" className="fm-handle-out" />
      <Handle type="source" position={Position.Bottom} id="bottom" className={hidden} />
      {!d.hasOut && <Stub />}
      <Reviewed d={d} />
      <Label d={d} />
    </div>
  );
}

export function TriggerNode({ data }: NodeProps) {
  const d = data as NodeData;
  const { icon, color } = iconFor(d.g);
  return (
    <div className={cls("fm-node fm-std fm-trigger", d.hasIn && "has-in", stateClass(d))} style={{ width: d.w, height: d.h }}>
      <span className="fm-bolt" title="Trigger / entry point">
        <svg width="16" height="16" viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
      </span>
      <Handle type="target" position={Position.Left} id="in" className="fm-handle-in" />
      <Handle type="target" position={Position.Top} id="top" className={hidden} />
      <Icon name={icon} size={30} style={{ color }} />
      <Handle type="source" position={Position.Right} id="out" className="fm-handle-out" />
      <Handle type="source" position={Position.Bottom} id="bottom" className={hidden} />
      {!d.hasOut && <Stub />}
      <Reviewed d={d} />
      <Label d={d} />
    </div>
  );
}

export function HubNode({ data }: NodeProps) {
  const d = data as NodeData;
  const { icon, color } = iconFor(d.g);
  const ports = d.g.ports ?? [];
  return (
    <div className={cls("fm-node fm-hub", stateClass(d))} style={{ width: d.w, height: d.h }}>
      <Handle type="target" position={Position.Left} id="in" className="fm-handle-in" />
      <Handle type="target" position={Position.Top} id="top" className={hidden} />
      <div className="fm-hub-head">
        <Icon name={icon} size={28} style={{ color }} />
        <div className="fm-hub-text">
          <div className="fm-hub-title">
            {d.g.label}
            {d.g.status === "deactivated" && <span className="fm-deact-tag"> (Deactivated)</span>}
          </div>
          {d.g.subtitle && <div className="fm-hub-sub">{d.g.subtitle}</div>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fm-handle-out" />
      <Handle type="source" position={Position.Bottom} id="bottom" className={hidden} />
      {ports.map((p, i) => {
        const x = portX(d.w, i, ports.length);
        return (
          <div key={p}>
            <Handle type="source" position={Position.Bottom} id={`port-${p}`} className="fm-port" style={{ left: x }} />
            <div className="fm-port-label" style={{ left: x }}>{p}</div>
          </div>
        );
      })}
      {!d.hasOut && <Stub />}
      <Reviewed d={d} />
    </div>
  );
}

export function SubNode({ data }: NodeProps) {
  const d = data as NodeData;
  const { icon, color } = iconFor(d.g);
  return (
    <div className={cls("fm-node fm-sub", stateClass(d))} style={{ width: G.subD, height: G.subD }}>
      <Handle type="target" position={Position.Top} id="top" className="fm-sub-top" />
      {d.g.port && <div className="fm-sub-port">{d.g.port}</div>}
      <Handle type="target" position={Position.Left} id="in" className={hidden} />
      <Icon name={icon} size={24} style={{ color }} />
      <Handle type="source" position={Position.Right} id="out" className={d.hasOut ? "fm-handle-out" : hidden} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={hidden} />
      <Reviewed d={d} />
      <Label d={d} />
    </div>
  );
}

export function MergeNode({ data }: NodeProps) {
  const d = data as NodeData;
  return (
    <div className={cls("fm-node fm-merge", stateClass(d))} style={{ width: G.merge, height: G.merge }}>
      <Handle type="target" position={Position.Left} id="in" className="fm-handle-in" />
      <Handle type="target" position={Position.Top} id="top" className={hidden} />
      <Icon name="merge" size={20} />
      <Handle type="source" position={Position.Right} id="out" className="fm-handle-out" />
      <Handle type="source" position={Position.Bottom} id="bottom" className={hidden} />
      <Label d={d} />
    </div>
  );
}

export function GroupNode({ data }: NodeProps) {
  const d = data as NodeData;
  return (
    <div className={cls("fm-node fm-std fm-group", stateClass(d))} style={{ width: d.w, height: d.h }} title="Click to expand">
      <span className="fm-group-layer l2" />
      <span className="fm-group-layer l1" />
      <Handle type="target" position={Position.Left} id="in" className="fm-handle-in" />
      <Handle type="target" position={Position.Top} id="top" className={hidden} />
      <Icon name="layers" size={28} style={{ color: "#c9ccd1" }} />
      <span className="fm-count">{d.g.count}</span>
      <Handle type="source" position={Position.Right} id="out" className="fm-handle-out" />
      <Handle type="source" position={Position.Bottom} id="bottom" className={hidden} />
      <Label d={d} />
    </div>
  );
}

export function ScreenNode({ data }: NodeProps) {
  const d = data as NodeData;
  const n = d.g;
  const reqs = n.requirements ?? [];
  const nv = n.variants?.length ?? 0;
  const red = d.badges?.filter((b) => b.sev === "red") ?? [];
  const amber = d.badges?.filter((b) => b.sev === "amber") ?? [];
  return (
    <div className={cls("fm-node fm-screen", nv > 0 && "has-variants", stateClass(d))} style={{ width: d.w, height: d.h }}>
      {nv > 0 && <><span className="fm-screen-layer l2" /><span className="fm-screen-layer l1" /></>}
      <Handle type="target" position={Position.Left} id="in" className="fm-handle-in" />
      <Handle type="target" position={Position.Top} id="top" className={hidden} />
      {d.src ? <img className="fm-thumb" src={d.src} alt={n.label} draggable={false} /> : <div className="fm-thumb fm-thumb-missing"><Icon name="image" size={28} /></div>}
      {n.entry && <span className="fm-entry" title="Entry screen"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg></span>}
      {nv > 0 && <span className="fm-variants" title={`${nv + 1} states: ${[n.state, ...n.variants!.map((v) => v.state ?? v.label)].join(", ")}`}>×{nv + 1}</span>}
      <div className="fm-gap-badges">
        {red.length > 0 && <span className="fm-gap red" title={red.map((b) => b.text).join("\n")}>{red.length}</span>}
        {amber.length > 0 && <span className="fm-gap amber" title={amber.map((b) => b.text).join("\n")}>{amber.length}</span>}
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fm-handle-out" />
      <Handle type="source" position={Position.Bottom} id="bottom" className={hidden} />
      <Reviewed d={d} />
      <div className="fm-label-wrap fm-screen-label">
        <div className="fm-label">{n.label}</div>
        <div className="fm-req-chips">
          {reqs.slice(0, 4).map((r) => <span key={r.id} className={`fm-req-chip c-${r.confidence ?? "high"}`}>{r.id}</span>)}
          {reqs.length > 4 && <span className="fm-req-chip">+{reqs.length - 4}</span>}
        </div>
      </div>
    </div>
  );
}

export const nodeTypes = { std: StdNode, trigger: TriggerNode, hub: HubNode, sub: SubNode, merge: MergeNode, group: GroupNode, screen: ScreenNode };
