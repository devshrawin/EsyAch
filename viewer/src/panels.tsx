// Side panels: node/edge drawers (read + edit), flow list with player and step editor,
// view/filter/group controls, and the Cmd/Ctrl+K search palette.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, iconFor } from "./icons";
import type { Group, Level, ViewOpts } from "./model";
import type { Evidence, Flow, GEdge, GNode, Graph, NodeKind } from "./types";

export const NODE_KINDS: NodeKind[] = ["entrypoint", "trigger", "ui", "hub", "service", "module", "datastore", "external",
  "queue", "job", "config", "util", "merge", "screen"];
const MECHANISMS = ["call", "http", "event", "sql", "file", "queue", "cache", "navigate", "other"];
const FLOW_KINDS = ["happy", "alternate", "failure", "side_effect", "scheduled"];

export type Edit = (fn: (g: Graph) => void) => void;

export function evText(e?: Evidence) {
  if (!e) return "";
  if (e.file) return `${e.file}:${e.line}`;
  if (e.req) return e.req;
  if (e.screen) return e.screen;
  if (e.section) return e.section;
  return e.user ? "edited by reviewer" : "";
}

function evToString(e: Evidence) {
  const head = e.file ? `${e.file}:${e.line}` : e.req ?? e.screen ?? e.section ?? "";
  return [head, e.note].filter(Boolean).join(" ");
}

function parseEvidence(s: string): Evidence | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\S+?):(\d+)\s*(.*)$/);
  if (m) return { file: m[1], line: Number(m[2]), ...(m[3] ? { note: m[3] } : {}) };
  const r = t.match(/^((?:FR|NFR|REQ|US|BR)[\w.-]*)\s*(.*)$/i);
  if (r) return { req: r[1], ...(r[2] ? { note: r[2] } : {}) };
  return { user: true, note: t };
}

// ------------------------------------------------------------------ form bits

/** Text input that commits on blur / Enter, so one edit = one undo step. */
export function TextField({ value, onCommit, multiline, placeholder, mono }: {
  value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; mono?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  const common = {
    value: v, placeholder, className: `fm-input ${mono ? "is-mono" : ""}`,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
  };
  return multiline
    ? <textarea rows={3} {...common} />
    : <input {...common} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />;
}

function Select({ value, options, onChange }: { value: string; options: (string | [string, string])[]; onChange: (v: string) => void }) {
  return (
    <select className="fm-input" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        return <option key={val} value={val}>{label}</option>;
      })}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="fm-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function EvidenceEditor({ list, onChange }: { list: Evidence[]; onChange: (l: Evidence[]) => void }) {
  return (
    <div className="fm-ev-edit">
      {list.map((e, i) => (
        <div key={i + evToString(e)} className="fm-ev-row">
          <TextField mono value={evToString(e)} placeholder="path/file.py:42 note" onCommit={(s) => {
            const p = parseEvidence(s);
            onChange(p ? list.map((x, j) => (j === i ? p : x)) : list.filter((_, j) => j !== i));
          }} />
          <button className="fm-btn" title="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button className="fm-btn fm-btn-ghost" onClick={() => onChange([...list, { user: true, note: "checked by reviewer" }])}>+ evidence</button>
      <div className="fm-hint">Format: <code>file:line note</code>, a requirement ID (<code>FR-3</code>) or free text.</div>
    </div>
  );
}

export function Badge({ c }: { c?: string }) {
  const v = c ?? "high";
  return <span className={`fm-conf c-${v}`}>{v} confidence</span>;
}

// ------------------------------------------------------------------ node drawer

export function NodeDrawer({ n, graph, editMode, edit, onClose, onPick, onPickEdge, onFlow, onDelete, onCollapseGroup, groupLabel }: {
  n: GNode; graph: Graph; editMode: boolean; edit: Edit; onClose: () => void; onPick: (id: string) => void;
  onPickEdge: (id: string) => void; onFlow: (id: string) => void; onDelete: () => void;
  onCollapseGroup?: () => void; groupLabel?: string;
}) {
  const byId = useMemo(() => new Map(graph.nodes.map((x) => [x.id, x])), [graph]);
  const inbound = graph.edges.filter((e) => e.to === n.id);
  const outbound = graph.edges.filter((e) => e.from === n.id);
  const flows = graph.flows.filter((f) => f.steps.some((s) => s.node === n.id));
  const { icon, color } = iconFor(n);
  const upd = (patch: Partial<GNode>) => edit((g) => {
    const t = g.nodes.find((x) => x.id === n.id);
    if (!t) return;
    Object.assign(t, patch, { edited: true });
    for (const k of Object.keys(patch) as (keyof GNode)[]) if (patch[k] === undefined || patch[k] === "") delete t[k];
  });
  const hubs = graph.nodes.filter((x) => x.kind === "hub" && x.id !== n.id);
  const hub = n.hub ? byId.get(n.hub) : undefined;
  const edgeRow = (e: GEdge, other: string, dir: "in" | "out") => (
    <li key={e.id}>
      <span className="fm-dir">{dir === "in" ? "←" : "→"}</span>
      <span className="fm-edge-other" onClick={() => onPick(other)}>{byId.get(other)?.label}</span>
      <span className="fm-edge-meta" onClick={() => onPickEdge(e.id)} title="Open edge">
        {[e.label, e.mechanism, e.sync === "async" ? "async" : "", e.kind === "dependency" ? "dep" : ""].filter(Boolean).join(" · ")}
      </span>
    </li>
  );
  return (
    <aside className="fm-drawer" data-testid="node-drawer">
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
        {n.confirmed && <span className="fm-chip c-ok">✓ reviewed</span>}
        {n.edited && <span className="fm-chip">edited</span>}
      </div>

      {editMode ? (
        <div className="fm-form">
          <Field label="Label"><TextField value={n.label} onCommit={(v) => upd({ label: v || n.label })} /></Field>
          <Field label="Subtitle"><TextField value={n.subtitle ?? ""} onCommit={(v) => upd({ subtitle: v })} /></Field>
          <div className="fm-form-row">
            <Field label="Kind"><Select value={n.kind} options={NODE_KINDS} onChange={(v) => upd({ kind: v as NodeKind, ...(v === "hub" && !n.ports ? { ports: [] } : {}) })} /></Field>
            <Field label="Tech / icon"><TextField value={n.tech ?? ""} placeholder="postgres, redis…" onCommit={(v) => upd({ tech: v })} /></Field>
          </div>
          <div className="fm-form-row">
            <Field label="Status"><Select value={n.status ?? "active"} options={["active", "deactivated"]} onChange={(v) => upd({ status: v as GNode["status"] })} /></Field>
            <Field label="Confidence"><Select value={n.confidence ?? "high"} options={["high", "med", "low"]} onChange={(v) => upd({ confidence: v as GNode["confidence"] })} /></Field>
          </div>
          <div className="fm-form-row">
            {!!graph.layers?.length && (
              <Field label="Layer"><Select value={n.layer ?? ""} options={[["", "—"], ...graph.layers.map((l) => [l.id, l.label] as [string, string])]} onChange={(v) => upd({ layer: v })} /></Field>
            )}
            {!!graph.groups?.length && (
              <Field label="Group"><Select value={n.group ?? ""} options={[["", "—"], ...graph.groups.map((l) => [l.id, l.label] as [string, string])]} onChange={(v) => upd({ group: v })} /></Field>
            )}
          </div>
          {n.kind === "hub" && (
            <Field label="Ports (comma separated)">
              <TextField value={(n.ports ?? []).join(", ")} onCommit={(v) => upd({ ports: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </Field>
          )}
          {n.kind !== "hub" && (
            <div className="fm-form-row">
              <Field label="Attach under hub">
                <Select value={n.hub ?? ""} options={[["", "— (standalone)"], ...hubs.map((h) => [h.id, h.label] as [string, string])]}
                  onChange={(v) => upd({ hub: v, port: v ? byId.get(v)?.ports?.[0] : undefined })} />
              </Field>
              {hub && (
                <Field label="Port"><Select value={n.port ?? ""} options={[["", "—"], ...(hub.ports ?? [])]} onChange={(v) => upd({ port: v })} /></Field>
              )}
            </div>
          )}
          <Field label="Summary"><TextField multiline value={n.summary ?? ""} onCommit={(v) => upd({ summary: v })} /></Field>
          <Field label="Evidence"><EvidenceEditor list={n.evidence ?? []} onChange={(l) => upd({ evidence: l })} /></Field>
          <label className="fm-check">
            <input type="checkbox" checked={!!n.confirmed} onChange={(e) => upd({ confirmed: e.target.checked || undefined })} />
            Reviewed: a person checked this node
          </label>
          <div className="fm-form-actions">
            {n.pos && <button className="fm-btn fm-btn-ghost" onClick={() => upd({ pos: undefined })}>Reset position</button>}
            <button className="fm-btn fm-btn-danger" onClick={onDelete}>Delete node</button>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}
      {onCollapseGroup && groupLabel && (
        <div className="fm-form-actions"><button className="fm-btn fm-btn-ghost" onClick={onCollapseGroup}>Collapse group "{groupLabel}"</button></div>
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

// ------------------------------------------------------------------ edge drawer

export function EdgeDrawer({ e, graph, editMode, edit, onClose, onPick, onDelete }: {
  e: GEdge; graph: Graph; editMode: boolean; edit: Edit; onClose: () => void; onPick: (id: string) => void; onDelete: () => void;
}) {
  const byId = new Map(graph.nodes.map((x) => [x.id, x]));
  const src = byId.get(e.from), tgt = byId.get(e.to);
  const real = graph.edges.some((x) => x.id === e.id);
  const upd = (patch: Partial<GEdge>) => edit((g) => {
    const t = g.edges.find((x) => x.id === e.id);
    if (!t) return;
    Object.assign(t, patch, { edited: true });
    for (const k of Object.keys(patch) as (keyof GEdge)[]) if (patch[k] === undefined || patch[k] === "") delete t[k];
  });
  const nodeOpts = graph.nodes.map((n) => [n.id, n.label] as [string, string]);
  const flows = graph.flows.filter((f) => f.steps.some((s) => s.edge === e.id));
  return (
    <aside className="fm-drawer" data-testid="edge-drawer">
      <div className="fm-drawer-head">
        <span className="fm-drawer-icon"><Icon name="next" size={18} /></span>
        <div>
          <div className="fm-drawer-title">
            <span className="fm-link" onClick={() => onPick(e.from)}>{src?.label ?? e.from}</span> → <span className="fm-link" onClick={() => onPick(e.to)}>{tgt?.label ?? e.to}</span>
          </div>
          <div className="fm-drawer-sub">{e.kind} edge · {e.mechanism}{e.sync === "async" ? " · async" : ""}</div>
        </div>
        <button className="fm-btn fm-close" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="fm-badges">
        <Badge c={e.confidence} />
        {e.inferred && <span className="fm-chip c-low">inferred</span>}
        {e.confirmed && <span className="fm-chip c-ok">✓ reviewed</span>}
        {e.edited && <span className="fm-chip">edited</span>}
      </div>
      {e.aggregate && e.aggregate.length > 1 && (
        <>
          <p className="fm-summary">{e.aggregate.length} edges are merged here because their ends are collapsed or folded. Expand the group or switch to Detail to edit them one by one.</p>
          <ul className="fm-edge-list">
            {e.aggregate.map((id) => {
              const x = graph.edges.find((y) => y.id === id);
              return x ? <li key={id}><span className="fm-edge-other">{byId.get(x.from)?.label} → {byId.get(x.to)?.label}</span><span className="fm-edge-meta">{x.label}</span></li> : null;
            })}
          </ul>
        </>
      )}
      {editMode && real ? (
        <div className="fm-form">
          <div className="fm-form-row">
            <Field label="From"><Select value={e.from} options={nodeOpts} onChange={(v) => upd({ from: v, port: undefined })} /></Field>
            <Field label="To"><Select value={e.to} options={nodeOpts} onChange={(v) => upd({ to: v })} /></Field>
          </div>
          <Field label="Label (next to the source port)"><TextField value={e.label ?? ""} placeholder="POST, BRPOP, Click Submit…" onCommit={(v) => upd({ label: v })} /></Field>
          <Field label="Payload"><TextField mono value={e.payload ?? ""} placeholder="{user_id, items}" onCommit={(v) => upd({ payload: v })} /></Field>
          <Field label="Condition"><TextField value={e.condition ?? ""} placeholder="cache miss" onCommit={(v) => upd({ condition: v })} /></Field>
          <div className="fm-form-row">
            <Field label="Kind"><Select value={e.kind} options={["main", "dependency"]} onChange={(v) => upd({ kind: v as GEdge["kind"] })} /></Field>
            <Field label="Mechanism"><Select value={e.mechanism} options={MECHANISMS} onChange={(v) => upd({ mechanism: v })} /></Field>
            <Field label="Timing"><Select value={e.sync ?? "sync"} options={["sync", "async"]} onChange={(v) => upd({ sync: v as GEdge["sync"] })} /></Field>
          </div>
          {src?.kind === "hub" && (
            <Field label="Leaves hub port"><Select value={e.port ?? ""} options={[["", "— (main output)"], ...(src.ports ?? [])]} onChange={(v) => upd({ port: v })} /></Field>
          )}
          <div className="fm-form-row">
            <Field label="Confidence"><Select value={e.confidence ?? "high"} options={["high", "med", "low"]} onChange={(v) => upd({ confidence: v as GEdge["confidence"] })} /></Field>
            <label className="fm-check fm-check-inline">
              <input type="checkbox" checked={!!e.inferred} onChange={(ev) => upd(ev.target.checked
                ? { inferred: true, confidence: e.confidence === "high" || !e.confidence ? "low" : e.confidence, reason: e.reason ?? "marked inferred by reviewer" }
                : { inferred: undefined, reason: undefined })} />
              Inferred
            </label>
          </div>
          {e.inferred && <Field label="Why inferred"><TextField value={e.reason ?? ""} onCommit={(v) => upd({ reason: v })} /></Field>}
          <Field label="Evidence"><EvidenceEditor list={e.evidence ?? []} onChange={(l) => upd({ evidence: l })} /></Field>
          <label className="fm-check">
            <input type="checkbox" checked={!!e.confirmed} onChange={(ev) => upd({ confirmed: ev.target.checked || undefined, ...(ev.target.checked && e.inferred ? { inferred: undefined, reason: undefined, confidence: "high" } : {}) })} />
            Reviewed: a person confirmed this edge{e.inferred ? " (clears the inferred flag)" : ""}
          </label>
          <div className="fm-form-actions">
            <button className="fm-btn fm-btn-ghost" onClick={() => upd({ from: e.to, to: e.from, port: undefined })}>Reverse direction</button>
            <button className="fm-btn fm-btn-danger" onClick={onDelete}>Delete edge</button>
          </div>
        </div>
      ) : (
        <div className="fm-form fm-readonly">
          {e.label && <div><b>Action:</b> {e.label}</div>}
          {e.payload && <div><b>Payload:</b> <code>{e.payload}</code></div>}
          {e.condition && <div><b>Condition:</b> {e.condition}</div>}
          {e.reason && <div><b>Why inferred:</b> {e.reason}</div>}
          {!!e.evidence?.length && <div className="fm-tip-ev">{e.evidence.map((x, i) => <code key={i} className="fm-ev">{evText(x)}</code>)}</div>}
        </div>
      )}
      <div className="fm-section-title">Flows using this edge ({flows.length})</div>
      <ul className="fm-edge-list">{flows.map((f) => <li key={f.id}><span className="fm-dir">⚡</span><span className="fm-edge-other">{f.name}</span></li>)}</ul>
    </aside>
  );
}

// ------------------------------------------------------------------ flows tab

export function FlowsTab(props: {
  graph: Graph; flowId: string | null; step: number; playing: boolean; editMode: boolean; edit: Edit;
  stepProblems: Map<number, string>; recording: boolean; actor: string | null;
  setActor: (a: string | null) => void; onSelect: (id: string | null) => void; goTo: (i: number) => void;
  setPlaying: (p: boolean) => void; setRecording: (r: boolean) => void; onNewFlow: () => void;
  listRef: React.RefObject<HTMLOListElement>;
  onWalk?: () => void;
}) {
  const { graph, flowId, step, playing, editMode, edit, actor } = props;
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const flow = graph.flows.find((f) => f.id === flowId);
  const actors = [...new Set(graph.flows.map((f) => f.actor).filter(Boolean))] as string[];
  const flows = graph.flows.filter((f) => !actor || f.actor === actor);
  const updFlow = (fn: (f: Flow) => void) => edit((g) => {
    const f = g.flows.find((x) => x.id === flowId);
    if (f) {
      fn(f);
      f.edited = true;
    }
  });
  const visited = new Set(flow?.steps.map((s) => s.node));
  const candidates = flow ? graph.edges.filter((e) => visited.has(e.from)) : [];

  return (
    <>
      <div className="fm-section-title fm-row">
        <span>{graph.mode === "code" ? "Flows" : "Journeys"} ({flows.length})</span>
        {editMode && <button className="fm-btn fm-btn-ghost fm-btn-sm" onClick={props.onNewFlow}>+ New</button>}
      </div>
      {actors.length > 1 && (
        <div className="fm-chips">
          <button className={`fm-chip-btn ${!actor ? "is-on" : ""}`} onClick={() => props.setActor(null)}>All actors</button>
          {actors.map((a) => <button key={a} className={`fm-chip-btn ${actor === a ? "is-on" : ""}`} onClick={() => props.setActor(a)}>{a}</button>)}
        </div>
      )}
      <ul className="fm-flow-list">
        {flows.map((f) => (
          <li key={f.id} className={f.id === flowId ? "is-active" : ""} onClick={() => props.onSelect(f.id === flowId ? null : f.id)}>
            <span className={`fm-flow-bolt k-${f.kind ?? "happy"}`}><Icon name="bolt" size={12} stroke={2.4} /></span>
            <div>
              <div className="fm-flow-name">{f.name}</div>
              <div className="fm-flow-meta">
                {f.kind && <span className={`fm-kind k-${f.kind}`}>{f.kind.replace("_", " ")}</span>}
                {f.actor && <span>{f.actor}</span>}
                <span>{f.steps.length} steps</span>
                {f.edited && <span>· edited</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {flow && (
        <div className="fm-player">
          <div className="fm-player-controls">
            <button className="fm-btn" onClick={() => props.goTo(0)} title="Restart"><Icon name="reset" size={15} /></button>
            <button className="fm-btn" onClick={() => props.goTo(step - 1)} title="Previous step (←)"><Icon name="prev" size={15} /></button>
            <button className="fm-btn fm-btn-primary" data-testid="play" onClick={() => {
              if (!playing && step >= flow.steps.length - 1) props.goTo(0);
              props.setPlaying(!playing);
            }} title="Play / pause (space)">
              <Icon name={playing ? "pause" : "play"} size={15} />
            </button>
            <button className="fm-btn" onClick={() => props.goTo(step + 1)} title="Next step (→)"><Icon name="next" size={15} /></button>
            <span className="fm-step-count">{step + 1} / {flow.steps.length}</span>
          </div>
          {props.onWalk && (
            <button className="fm-btn fm-btn-text fm-walk-btn" onClick={props.onWalk} data-testid="walk">▶ Walk through the screens</button>
          )}
          {editMode ? (
            <div className="fm-form">
              <Field label="Name"><TextField value={flow.name} onCommit={(v) => updFlow((f) => { f.name = v || f.name; })} /></Field>
              <div className="fm-form-row">
                <Field label="Kind"><Select value={flow.kind ?? "happy"} options={FLOW_KINDS} onChange={(v) => updFlow((f) => { f.kind = v as Flow["kind"]; })} /></Field>
                <Field label="Actor"><TextField value={flow.actor ?? ""} onCommit={(v) => updFlow((f) => { if (v) f.actor = v; else delete f.actor; })} /></Field>
              </div>
              <Field label="Description"><TextField multiline value={flow.description ?? ""} onCommit={(v) => updFlow((f) => { f.description = v; })} /></Field>
            </div>
          ) : flow.description && <p className="fm-flow-desc">{flow.description}</p>}
          <ol className="fm-steps" ref={props.listRef}>
            {flow.steps.map((s, i) => {
              const bad = props.stepProblems.get(i);
              return (
                <li key={i} className={`${i === step ? "is-current" : i < step ? "is-done" : ""} ${bad ? "is-bad" : ""}`} onClick={() => props.goTo(i)}>
                  <span className="fm-step-n">{i + 1}</span>
                  <div className="fm-step-body">
                    <div className="fm-step-node">{byId.get(s.node)?.label ?? s.node}</div>
                    {editMode ? (
                      <div className="fm-step-edit" onClick={(e) => e.stopPropagation()}>
                        <TextField multiline value={s.description} placeholder="What happens here" onCommit={(v) => updFlow((f) => { f.steps[i].description = v; })} />
                        <TextField mono value={s.payload ?? ""} placeholder="payload" onCommit={(v) => updFlow((f) => { if (v) f.steps[i].payload = v; else delete f.steps[i].payload; })} />
                        <div className="fm-step-tools">
                          <button className="fm-btn fm-btn-sm" disabled={i < 2} title="Move up" onClick={() => updFlow((f) => { [f.steps[i - 1], f.steps[i]] = [f.steps[i], f.steps[i - 1]]; })}>↑</button>
                          <button className="fm-btn fm-btn-sm" disabled={i === 0 || i === flow.steps.length - 1} title="Move down" onClick={() => updFlow((f) => { [f.steps[i + 1], f.steps[i]] = [f.steps[i], f.steps[i + 1]]; })}>↓</button>
                          <button className="fm-btn fm-btn-sm" disabled={i === 0} title="Remove step" onClick={() => updFlow((f) => { f.steps.splice(i, 1); })}>✕</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="fm-step-desc">{s.description}</div>
                        {s.evidence && <code className="fm-ev">{evText(s.evidence)}</code>}
                      </>
                    )}
                    {bad && <div className="fm-step-bad">⚠ {bad}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
          {editMode && (
            <div className="fm-form">
              <Field label="Add next step (edges leaving a reached node)">
                <select className="fm-input" value="" onChange={(ev) => {
                  const e = graph.edges.find((x) => x.id === ev.target.value);
                  if (e) updFlow((f) => { f.steps.push({ node: e.to, edge: e.id, description: e.label ? `${e.label}` : "" }); });
                }}>
                  <option value="">Choose an edge…</option>
                  {candidates.map((e) => (
                    <option key={e.id} value={e.id}>{byId.get(e.from)?.label} → {byId.get(e.to)?.label}{e.label ? ` · ${e.label}` : ""}</option>
                  ))}
                </select>
              </Field>
              <label className="fm-check">
                <input type="checkbox" checked={props.recording} onChange={(e) => props.setRecording(e.target.checked)} />
                Record: clicking an edge on the canvas appends it as the next step
              </label>
              <div className="fm-form-actions">
                <button className="fm-btn fm-btn-danger" onClick={() => {
                  edit((g) => { g.flows = g.flows.filter((f) => f.id !== flowId); });
                  props.onSelect(null);
                }}>Delete flow</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ view tab

export function ViewTab({ graph, opts, setOpts, groups, groupCounts, isSpec }: {
  graph: Graph; opts: ViewOpts; setOpts: (fn: (o: ViewOpts) => ViewOpts) => void; groups: Group[]; groupCounts: Map<string, number>; isSpec?: boolean;
}) {
  const kinds = new Map<string, number>();
  for (const n of graph.nodes) kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1);
  const layers = graph.layers ?? [];
  const toggle = (set: Set<string>, v: string) => {
    const s = new Set(set);
    if (s.has(v)) s.delete(v);
    else s.add(v);
    return s;
  };
  const levels: [Level, string, string][] = [
    ["overview", "Overview", "main path only; circles fold into hubs"],
    ["structure", "Structure", "all nodes and dependencies, short labels"],
    ["detail", "Detail", "everything, with payloads on edges"],
  ];
  return (
    <div className="fm-view-tab">
      <div className="fm-section-title">Detail level</div>
      <div className="fm-seg">
        {levels.map(([id, label, hint]) => (
          <button key={id} title={hint} className={opts.level === id ? "is-on" : ""} onClick={() => setOpts((o) => ({ ...o, level: id }))}>{label}</button>
        ))}
      </div>
      {isSpec && (
        <>
          <div className="fm-section-title">Actor</div>
          <div className="fm-chips" data-testid="actor-filter">
            <button className={`fm-chip-btn ${!opts.actor ? "is-on" : ""}`} onClick={() => setOpts((o) => ({ ...o, actor: null }))}>All</button>
            {(graph.actors ?? []).map((a) => (
              <button key={a.id} className={`fm-chip-btn ${opts.actor === a.id ? "is-on" : ""}`} onClick={() => setOpts((o) => ({ ...o, actor: a.id }))}>{a.label}</button>
            ))}
          </div>
          <label className="fm-check"><input type="checkbox" checked={!!opts.showGlobal} onChange={(e) => setOpts((o) => ({ ...o, showGlobal: e.target.checked }))} /> Global navigation (header links, sign out)</label>
        </>
      )}
      <label className="fm-check"><input type="checkbox" checked={opts.showDeps} onChange={(e) => setOpts((o) => ({ ...o, showDeps: e.target.checked }))} /> Dependency edges (dashed)</label>
      <label className="fm-check"><input type="checkbox" checked={opts.showDeactivated} onChange={(e) => setOpts((o) => ({ ...o, showDeactivated: e.target.checked }))} /> Deactivated / dead code</label>

      <div className="fm-section-title">Node kinds</div>
      <div className="fm-chips">
        {[...kinds].map(([k, c]) => (
          <button key={k} className={`fm-chip-btn ${opts.hiddenKinds.has(k) ? "" : "is-on"}`} onClick={() => setOpts((o) => ({ ...o, hiddenKinds: toggle(o.hiddenKinds, k) }))}>
            {k} <span>{c}</span>
          </button>
        ))}
      </div>
      {!!layers.length && (
        <>
          <div className="fm-section-title">Layers</div>
          <div className="fm-chips">
            {layers.map((l) => (
              <button key={l.id} className={`fm-chip-btn ${opts.hiddenLayers.has(l.id) ? "" : "is-on"}`} onClick={() => setOpts((o) => ({ ...o, hiddenLayers: toggle(o.hiddenLayers, l.id) }))}>{l.label}</button>
            ))}
          </div>
        </>
      )}
      {!!groups.length && (
        <>
          <div className="fm-section-title fm-row">
            <span>Groups{groups[0]?.auto ? " (by folder)" : ""}</span>
            <span>
              <button className="fm-btn fm-btn-ghost fm-btn-sm" onClick={() => setOpts((o) => ({ ...o, collapsed: new Set(groups.map((g) => g.id)) }))}>Collapse all</button>
              <button className="fm-btn fm-btn-ghost fm-btn-sm" onClick={() => setOpts((o) => ({ ...o, collapsed: new Set() }))}>Expand all</button>
            </span>
          </div>
          <ul className="fm-group-list">
            {groups.map((g) => (
              <li key={g.id}>
                <label className="fm-check">
                  <input type="checkbox" checked={!opts.collapsed.has(g.id)} onChange={() => setOpts((o) => ({ ...o, collapsed: toggle(o.collapsed, g.id) }))} />
                  {g.label}
                </label>
                <span className="fm-muted">{groupCounts.get(g.id) ?? 0}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ search palette

interface Hit { type: "node" | "flow" | "group" | "req"; id: string; title: string; sub: string; score: number }

export function SearchPalette({ graph, groups, onPick, onClose }: {
  graph: Graph; groups: Group[]; onPick: (h: { type: Hit["type"]; id: string }) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    const score = (fields: string[]) => {
      if (!t) return 1;
      let best = 0;
      fields.forEach((f, k) => {
        const s = f.toLowerCase();
        const at = s.indexOf(t);
        if (at === 0) best = Math.max(best, 100 - k * 10);
        else if (at > 0) best = Math.max(best, 60 - k * 10);
      });
      return best;
    };
    const out: Hit[] = [];
    for (const n of graph.nodes) {
      const s = score([n.label, n.subtitle ?? "", n.id, ...(n.symbols ?? []), ...(n.files ?? []), n.summary ?? ""]);
      if (s > 0) out.push({ type: "node", id: n.id, title: n.label, sub: [n.kind, n.subtitle].filter(Boolean).join(" · "), score: s + 5 });
    }
    for (const f of graph.flows) {
      const s = score([f.name, f.actor ?? "", f.description ?? ""]);
      if (s > 0) out.push({ type: "flow", id: f.id, title: f.name, sub: `flow · ${f.steps.length} steps${f.actor ? " · " + f.actor : ""}`, score: s + 8 });
    }
    for (const r of graph.requirements ?? []) {
      const s = score([r.id, r.text, r.section ?? ""]);
      if (s > 0) out.push({ type: "req", id: r.id, title: r.id, sub: r.text, score: s + 6 });
    }
    for (const g of groups) {
      const s = score([g.label, g.id]);
      if (s > 0) out.push({ type: "group", id: g.id, title: g.label, sub: "group", score: s });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 40);
  }, [q, graph, groups]);
  useEffect(() => setI(0), [q]);
  const pick = (h?: Hit) => h && onPick({ type: h.type, id: h.id });
  const cur = Math.min(i, hits.length - 1); // a stale hover index can point past a shorter result list
  return (
    <div className="fm-modal-back" onMouseDown={onClose}>
      <div className="fm-palette" onMouseDown={(e) => e.stopPropagation()} data-testid="search">
        <div className="fm-palette-input">
          <Icon name="search" size={16} />
          <input ref={input} value={q} placeholder="Search nodes, files, symbols, flows…" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              else if (e.key === "Enter") pick(hits[cur]);
              else if (e.key === "Escape") onClose();
            }} />
          <kbd>esc</kbd>
        </div>
        <ul>
          {hits.map((h, k) => (
            <li key={h.type + h.id} className={k === cur ? "is-active" : ""} onMouseEnter={() => setI(k)} onClick={() => pick(h)}>
              <span className={`fm-hit-type t-${h.type}`}>{h.type}</span>
              <span className="fm-hit-title">{h.title}</span>
              <span className="fm-hit-sub">{h.sub}</span>
            </li>
          ))}
          {!hits.length && <li className="fm-muted">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dropdown menu

export function Menu({ label, icon, items, testid }: {
  label: string; icon?: string; testid?: string;
  items: ({ label: string; hint?: string; onClick: () => void; disabled?: boolean } | "sep")[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="fm-menu" ref={ref}>
      <button className="fm-btn fm-btn-text" data-testid={testid} onClick={() => setOpen(!open)}>
        {icon && <Icon name={icon} size={15} />} <span className="fm-menu-label">{label}</span> ▾
      </button>
      {open && (
        <div className="fm-menu-pop">
          {items.map((it, k) => it === "sep" ? <hr key={k} /> : (
            <button key={k} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>
              <span>{it.label}</span>{it.hint && <small>{it.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
