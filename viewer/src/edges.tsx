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
  animKey: number;
  showLabels: boolean;
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
    d.current && "is-current"].filter(Boolean).join(" ");
  // Main edges: action label near the source port, payload/condition in the mid pill.
  // Dependency edges leave a named hub port already, so their short label goes in the pill.
  const portLabel = dep ? undefined : e.label;
  let pill = dep ? e.label : e.condition ? `if ${e.condition}` : e.payload;
  if (d.cross && !d.inFlow) pill = undefined; // long cross-hub lines: label only while replaying
  // Port label sits on the curve ~20% from the source, so fanned-out edges don't stack labels.
  const sp = sourcePosition === Position.Right
    ? bezierPoint(sourceX, sourceY, targetX, targetY, 0.3, 0.2)
    : { x: sourceX + 8, y: sourceY + 12 };

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
            style={{ transform: `translate(-50%, -100%) translate(${sp.x}px, ${sp.y - 3}px)` }}
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
function bezierPoint(sx: number, sy: number, tx: number, ty: number, curvature: number, t: number) {
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
