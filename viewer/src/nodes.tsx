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
  [key: string]: unknown;
}

function cls(...xs: (string | false | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function stateClass(d: NodeData) {
  return cls(d.dim && "is-dim", d.inFlow && "in-flow", d.current && "is-current", d.selected && "is-selected",
    d.g.status === "deactivated" && "is-deact", d.g.confidence === "low" && "is-low");
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

export const nodeTypes = { std: StdNode, trigger: TriggerNode, hub: HubNode, sub: SubNode, merge: MergeNode };
