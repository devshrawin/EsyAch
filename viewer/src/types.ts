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
  // Mode B screens
  image?: string;
  image_size?: [number, number];
  entry?: boolean;
  actors?: string[];
  state?: string;
  purpose?: string;
  requirements?: ReqLink[];
  hotspots?: Hotspot[];
  variants?: Variant[];
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
  // Mode B
  hotspot?: string; // control on the source screen that triggers this transition
  reqs?: string[];
  global?: boolean; // header / sign-out style navigation available everywhere
  to_variant?: string;
}

export interface ReqLink { id: string; confidence?: Confidence; reason?: string }
export interface Hotspot {
  id: string; label: string; kind: string; box: [number, number, number, number];
  in_place?: boolean; note?: string;
}
export interface Variant { id: string; label?: string; image: string; state?: string; hotspots?: Hotspot[] }
export interface Requirement { id: string; text: string; priority?: string | null; section?: string; kind?: string; ui?: boolean }
export interface Finding {
  id: string; type: string; severity?: string; req?: string; screen?: string; hotspot?: string; text: string;
  srs_says?: string; screen_shows?: string; evidence?: Evidence[]; confidence?: Confidence;
}

export interface FlowStep {
  node: string;
  edge?: string;
  description: string;
  payload?: string;
  evidence?: Evidence;
  variant?: string; // Mode B: which state of the screen this step shows
  hotspot?: string; // Mode B: the control used on this screen (pulses in the walkthrough)
  action?: boolean; // Mode B: in-place action, no transition
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
  project: { name: string; source?: string; summary?: string; generated_at?: string; srs?: string; screens_dir?: string };
  requirements?: Requirement[];
  actors?: { id: string; label: string }[];
  findings?: Finding[];
  assets?: Record<string, string>; // image name -> data: URI (added by build.py)
  view?: { prototype?: boolean; start?: string; theme?: string };
  layers?: { id: string; label: string }[];
  groups?: { id: string; label: string; parent?: string }[];
  nodes: GNode[];
  edges: GEdge[];
  flows: Flow[];
}
