// Shared graph schema ("flowmap/1"). Mirrors scripts/validate.py and docs/schema.md.

export type NodeKind =
  | "entrypoint" | "trigger" | "hub" | "service" | "module" | "datastore" | "external"
  | "queue" | "ui" | "job" | "config" | "util" | "merge" | "screen";

export type Confidence = "high" | "med" | "low";

export interface Evidence {
  file?: string;
  line?: number;
  note?: string;
  req?: string;
  screen?: string;
  section?: string;
  user?: boolean; // added or corrected by a person in the editor
}

export interface GNode {
  id: string;
  label: string;
  subtitle?: string;
  kind: NodeKind;
  tech?: string;
  layer?: string;
  group?: string;
  hub?: string;
  port?: string;
  ports?: string[];
  files?: string[];
  summary?: string;
  symbols?: string[];
  status?: "active" | "deactivated";
  confidence?: Confidence;
  evidence?: Evidence[];
  pos?: { x: number; y: number }; // manual position from the editor (overrides auto layout)
  edited?: boolean;
  confirmed?: boolean;
  // view-only (never saved): a collapsed group drawn as one node
  collapsedGroup?: string;
  count?: number;
}

export interface GEdge {
  id: string;
  from: string;
  to: string;
  kind: "main" | "dependency";
  mechanism: string;
  sync?: "sync" | "async";
  port?: string;
  label?: string;
  payload?: string;
  condition?: string;
  inferred?: boolean;
  reason?: string;
  confidence?: Confidence;
  evidence?: Evidence[];
  edited?: boolean;
  confirmed?: boolean;
  aggregate?: string[]; // view-only: original edge ids merged into this one
}

export interface FlowStep {
  node: string;
  edge?: string;
  description: string;
  payload?: string;
  evidence?: Evidence;
}

export interface Flow {
  id: string;
  name: string;
  kind?: "happy" | "alternate" | "failure" | "side_effect" | "scheduled";
  actor?: string;
  description?: string;
  trigger: string;
  steps: FlowStep[];
  edited?: boolean;
}

export interface Graph {
  schema: "flowmap/1";
  mode: "code" | "spec";
  project: { name: string; source?: string; summary?: string; generated_at?: string };
  layers?: { id: string; label: string }[];
  groups?: { id: string; label: string; parent?: string }[];
  nodes: GNode[];
  edges: GEdge[];
  flows: Flow[];
}
