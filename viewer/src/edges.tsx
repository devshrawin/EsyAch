// Bezier edges in the n8n style: solid main flow with arrowheads, dashed dependencies,
// a label near the source port, a mid-edge pill, and an animated dot for the current step.
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, type EdgeProps } from "@xyflow/react";
import type { GEdge } from "./types";

export interface EdgeData {
  g: GEdge;
  dim: boolean;
  inFlow: boolean;
  current: boolean;
  cross: boolean; // dependency edge to a circle owned by another hub (or a non-hub source)
  fanOut: boolean; // source has several main outputs: spread port labels along the curves
  animKey: number;
  selected?: boolean;
  showLabels: boolean;
  payloads?: boolean; // Detail level: payloads in the mid-edge label
  [key: string]: unknown;
}

export function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd } = props;
  const d = props.data as EdgeData;
  const e = d.g;
  const dep = e.kind === "dependency";
  const [path, lx, ly] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    curvature: dep ? 0.35 : 0.3,
  });
  const cls = ["fm-edge", dep && "is-dep", d.cross && "is-cross", e.inferred && "is-inferred", d.dim && "is-dim", d.inFlow && "in-flow",
    d.current && "is-current", d.selected && "is-selected"].filter(Boolean).join(" ");
  // Main edges: action label near the source port, payload/condition in the mid pill.
  // Dependency edges leave a named hub port already, so their short label goes in the pill.
  const portLabel = dep ? undefined : e.label;
  // Hub -> own circle lines are already named by the port, as in n8n; their label lives in the hover card.
  let pill = dep ? (d.cross ? e.label : undefined) : e.condition ? `if ${e.condition}` : d.payloads !== false || d.inFlow ? e.payload : undefined;
  if (dep && !d.cross && d.current) pill = e.label;
  if (d.cross && !d.inFlow) pill = undefined; // long cross-hub lines: label only while replaying
  // n8n puts the port label right after the output dot; with several outputs on one handle
  // we slide it ~20% along each curve so the labels don't stack.
  const sp = sourcePosition !== Position.Right
    ? { x: sourceX + 8, y: sourceY + 12, a: "translate(0, -100%)" }
    : d.fanOut
      ? { ...bezierPoint(sourceX, sourceY, targetX, targetY, 0.3, 0.2), a: "translate(-50%, -100%)" }
      : { x: sourceX + 9, y: sourceY, a: "translate(0, -100%)" };

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={cls} interactionWidth={18} />
      {d.current && (
        <circle key={d.animKey} r={5.5} className="fm-edge-dot">
          <animateMotion dur="1.1s" repeatCount="1" fill="freeze" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1" />
        </circle>
      )}
      <EdgeLabelRenderer>
        {d.showLabels && portLabel && (
          <div
            className={`fm-src-label ${d.dim ? "is-dim" : ""}`}
            style={{ transform: `translate(${sp.x}px, ${sp.y - 2}px) ${sp.a}` }}
          >
            {portLabel}
          </div>
        )}
        {d.showLabels && pill && (
          <div
            className={`fm-pill nodrag nopan ${dep ? "is-dep" : ""} ${d.dim ? "is-dim" : ""} ${d.inFlow ? "in-flow" : ""} ${d.current ? "is-current" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {pill}
            {e.inferred && <span className="fm-q" title={e.reason ?? "inferred"}>?</span>}
          </div>
        )}
        {!d.showLabels && e.inferred && (
          <div className="fm-pill fm-q-only" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            <span className="fm-q">?</span>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

// Same control points as xyflow's getBezierPath for a Right -> Left edge.
export function bezierPoint(sx: number, sy: number, tx: number, ty: number, curvature: number, t: number) {
  const dist = tx - sx;
  const off = dist >= 0 ? 0.5 * dist : curvature * 25 * Math.sqrt(-dist);
  const c1x = sx + off, c2x = tx - off;
  const u = 1 - t;
  return {
    x: u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx,
    y: u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * ty + t * t * t * ty,
  };
}

export const edgeTypes = { flow: FlowEdge };
