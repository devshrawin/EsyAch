// Mode B screen viewer: full-size screenshot with clickable hotspots (use the platform like a
// prototype), back/breadcrumb, journey walkthrough with a pulsing hotspot, and hotspot editing.
import { useEffect, useMemo, useRef, useState } from "react";
import { assetSrc, type Coverage } from "./coverage";
import { Icon } from "./icons";
import { freshId } from "./model";
import { TextField, type Edit } from "./panels";
import type { Flow, GEdge, GNode, Graph, Hotspot } from "./types";

type Box = [number, number, number, number];
interface Loc { s: string; v?: string }

const HOTSPOT_KINDS = ["button", "link", "tab", "menu", "field", "toggle", "checkbox", "image", "other"];

export function Lightbox(props: {
  graph: Graph; cov: Coverage; start: Loc; editMode: boolean; edit: Edit; prototype?: boolean;
  flow?: Flow; step: number; goTo: (i: number) => void; playing: boolean; setPlaying: (p: boolean) => void;
  onClose: () => void; onReq: (id: string) => void; onShowOnCanvas: (id: string) => void;
}) {
  const { graph, cov, editMode, edit, flow, step } = props;
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const reqText = useMemo(() => new Map((graph.requirements ?? []).map((r) => [r.id, r])), [graph]);
  const [stack, setStack] = useState<Loc[]>([props.start]);
  const [walk, setWalk] = useState(!!flow && !props.prototype);
  const [hover, setHover] = useState<string | null>(null);
  const [chooser, setChooser] = useState<{ h: Hotspot; edges: GEdge[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selHs, setSelHs] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ id: string | null; box: Box } | null>(null);
  const imgWrap = useRef<HTMLDivElement>(null);

  // In walkthrough the journey decides which screen is shown.
  const cur: Loc = walk && flow ? { s: flow.steps[step].node, v: flow.steps[step].variant } : stack[stack.length - 1];
  const n = byId.get(cur.s);
  useEffect(() => { setChooser(null); setMsg(null); setSelHs(null); }, [cur.s, cur.v]);
  useEffect(() => { if (flow && !props.prototype) setWalk(true); }, [flow?.id]);
  useEffect(() => { setStack([props.start]); }, [props.start.s, props.start.v]);

  if (!n) return null;
  const variant = cur.v ? n.variants?.find((v) => v.id === cur.v) : undefined;
  const hotspots: Hotspot[] = (variant?.hotspots ?? n.hotspots) ?? [];
  const src = assetSrc(graph, n, cur.v);
  const outEdges = (h: string) => graph.edges.filter((e) => e.from === n.id && e.hotspot === h);
  const findings = cov.findings.filter((f) => f.screen === n.id);
  const dead = new Set(cov.deadHotspots.filter((d) => d.screen === n.id).map((d) => d.hotspot));
  const curStep = walk && flow ? flow.steps[step] : undefined;
  const pulse = curStep?.hotspot;

  const go = (to: string, v?: string) => {
    setStack((st) => [...st, { s: to, v }]);
    setWalk(false);
  };
  const follow = (e: GEdge) => {
    setChooser(null);
    if (walk && flow && flow.steps[step + 1]?.edge === e.id) {
      props.goTo(step + 1);
      return;
    }
    go(e.to, e.to_variant);
  };
  const clickHotspot = (h: Hotspot) => {
    if (editMode) {
      setSelHs(h.id);
      return;
    }
    const es = outEdges(h.id);
    if (walk && flow) {
      const next = flow.steps[step + 1];
      if (next && !next.edge && next.action && next.hotspot === h.id) return props.goTo(step + 1);
      const e = es.find((x) => x.id === next?.edge);
      if (e) return follow(e);
    }
    if (es.length === 1) follow(es[0]);
    else if (es.length > 1) setChooser({ h, edges: es });
    else setMsg(h.in_place ? `"${h.label}" stays on this screen${h.note ? `: ${h.note}` : ""}.` : `"${h.label}" leads nowhere in these screenshots (coverage gap).`);
  };

  // ------------------------------------------------------------------ editing hotspots
  const hsPath = (g: Graph) => {
    const t = g.nodes.find((x) => x.id === n.id)!;
    const v = cur.v ? t.variants?.find((x) => x.id === cur.v) : undefined;
    if (v) return (v.hotspots ??= []);
    return (t.hotspots ??= []);
  };
  const updHs = (id: string, patch: Partial<Hotspot>) => edit((g) => {
    const h = hsPath(g).find((x) => x.id === id);
    if (h) Object.assign(h, patch);
    const t = g.nodes.find((x) => x.id === n.id)!;
    t.edited = true;
  });
  const rel = (ev: React.MouseEvent | MouseEvent): [number, number] => {
    const r = imgWrap.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
  };
  const round = (b: Box): Box => b.map((v) => Math.round(v * 1000) / 1000) as Box;
  const startDrag = (ev: React.MouseEvent, mode: "draw" | "move" | "resize", h?: Hotspot) => {
    if (!editMode) return;
    ev.preventDefault();
    ev.stopPropagation();
    const [x0, y0] = rel(ev);
    const orig: Box = h ? [...h.box] as Box : [x0, y0, 0, 0];
    let last: Box = orig;
    const move = (e: MouseEvent) => {
      const [x, y] = rel(e);
      if (mode === "draw") last = [Math.min(x0, x), Math.min(y0, y), Math.abs(x - x0), Math.abs(y - y0)];
      else if (mode === "move") last = [Math.min(1 - orig[2], Math.max(0, orig[0] + x - x0)), Math.min(1 - orig[3], Math.max(0, orig[1] + y - y0)), orig[2], orig[3]];
      else last = [orig[0], orig[1], Math.max(0.01, Math.min(1 - orig[0], orig[2] + x - x0)), Math.max(0.01, Math.min(1 - orig[1], orig[3] + y - y0))];
      setTemp({ id: h?.id ?? null, box: last });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setTemp(null);
      if (mode === "draw") {
        if (last[2] < 0.01 || last[3] < 0.01) return;
        const id = freshId("h", hotspots.map((x) => x.id));
        edit((g) => {
          hsPath(g).push({ id, label: "New control", kind: "button", box: round(last) });
          g.nodes.find((x) => x.id === n.id)!.edited = true;
        });
        setSelHs(id);
      } else if (h && last !== orig) updHs(h.id, { box: round(last) });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const deleteHs = (id: string) => {
    const gone = new Set(graph.edges.filter((e) => e.from === n.id && e.hotspot === id).map((e) => e.id));
    edit((g) => {
      const list = hsPath(g);
      list.splice(list.findIndex((x) => x.id === id), 1);
      g.edges = g.edges.filter((e) => !gone.has(e.id));
      for (const f of g.flows) f.steps = f.steps.filter((s) => !(s.edge && gone.has(s.edge)));
    });
    setSelHs(null);
  };
  const linkHs = (h: Hotspot, to: string) => {
    const id = freshId("e_user_", graph.edges.map((e) => e.id));
    edit((g) => {
      g.edges.push({
        id, from: n.id, to, kind: "main", mechanism: "navigate", hotspot: h.id, label: `Click ${h.label}`, reqs: [],
        confidence: "med", edited: true, evidence: [{ user: true, note: "linked in editor" }],
      });
    });
  };
  const updEdge = (id: string, patch: Partial<GEdge>) => edit((g) => {
    const e = g.edges.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch, { edited: true });
    for (const k of Object.keys(patch) as (keyof GEdge)[]) if (patch[k] === undefined || patch[k] === "") delete e[k];
  });
  const selected = hotspots.find((h) => h.id === selHs);
  const screens = graph.nodes.filter((x) => x.kind === "screen");

  const updScreen = (patch: Partial<GNode>) => edit((g) => {
    const t = g.nodes.find((x) => x.id === n.id);
    if (t) Object.assign(t, patch, { edited: true });
  });

  return (
    <div className={`fm-lightbox ${props.prototype ? "is-prototype" : ""}`} data-testid="lightbox">
      <div className="fm-lb-bar">
        {!props.prototype && <button className="fm-btn" onClick={props.onClose} title="Close (Esc)"><Icon name="x" size={16} /></button>}
        <button className="fm-btn fm-btn-text" disabled={walk || stack.length < 2} onClick={() => setStack((s) => s.slice(0, -1))} data-testid="lb-back">← Back</button>
        <div className="fm-crumbs">
          {(walk && flow ? flow.steps.slice(0, step + 1).map((s) => ({ s: s.node, v: s.variant })) : stack).map((l, i, arr) => (
            <span key={i}>
              {i > 0 && <span className="fm-dir"> › </span>}
              <button className={`fm-crumb ${i === arr.length - 1 ? "is-on" : ""}`} onClick={() => walk && flow ? props.goTo(i) : setStack((s) => s.slice(0, i + 1))}>
                {byId.get(l.s)?.label}{l.v ? ` (${byId.get(l.s)?.variants?.find((x) => x.id === l.v)?.label ?? l.v})` : ""}
              </button>
            </span>
          ))}
        </div>
        {!!n.variants?.length && (
          <div className="fm-seg fm-lb-variants">
            <button className={!cur.v ? "is-on" : ""} onClick={() => walk ? null : setStack((s) => [...s.slice(0, -1), { s: n.id }])}>{n.state ?? "default"}</button>
            {n.variants.map((v) => (
              <button key={v.id} className={cur.v === v.id ? "is-on" : ""} onClick={() => walk ? null : setStack((s) => [...s.slice(0, -1), { s: n.id, v: v.id }])}>{v.state ?? v.label}</button>
            ))}
          </div>
        )}
        {!props.prototype && !editMode && <button className="fm-btn fm-btn-text" onClick={() => props.onShowOnCanvas(n.id)}>Show on canvas</button>}
        {editMode && <span className="fm-chip c-warn">Edit: drag on the image to draw a hotspot · drag to move · corner to resize</span>}
      </div>

      <div className="fm-lb-body">
        <div className="fm-lb-stage" onMouseDown={() => setChooser(null)}>
          <div className="fm-lb-imgwrap" ref={imgWrap} onMouseDown={(e) => editMode && e.target === e.currentTarget.querySelector("img") && startDrag(e, "draw")}>
            {src ? <img src={src} alt={n.label} draggable={false} data-testid="lb-image" /> : <div className="fm-thumb-missing fm-lb-missing">No image embedded for {n.image}</div>}
            {hotspots.map((h) => {
              const b = temp?.id === h.id ? temp.box : h.box;
              const es = outEdges(h.id);
              const cls = ["fm-hs", `k-${h.kind}`, es.length ? "is-link" : "", dead.has(h.id) ? "is-dead" : "", h.in_place ? "is-inplace" : "",
                pulse === h.id ? "is-pulse" : "", selHs === h.id ? "is-sel" : "", hover === h.id ? "is-hover" : ""].join(" ");
              return (
                <div key={h.id} className={cls} data-hs={h.id}
                  style={{ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${b[2] * 100}%`, height: `${b[3] * 100}%` }}
                  onMouseEnter={() => setHover(h.id)} onMouseLeave={() => setHover(null)}
                  onMouseDown={(e) => editMode ? (setSelHs(h.id), startDrag(e, "move", h)) : e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); clickHotspot(h); }}>
                  {hover === h.id && !editMode && !chooser && (
                    <div className="fm-hs-tip">
                      <b>{h.label}</b>
                      {es.length ? es.map((e) => <div key={e.id}>→ {byId.get(e.to)?.label}{e.to_variant ? ` (${e.to_variant})` : ""}{e.condition ? ` · if ${e.condition}` : ""}{e.inferred ? " · inferred" : ""}</div>)
                        : <div>{h.in_place ? `stays here${h.note ? `: ${h.note}` : ""}` : h.kind === "field" ? "input field" : "no destination (gap)"}</div>}
                    </div>
                  )}
                  {editMode && selHs === h.id && <span className="fm-hs-resize" onMouseDown={(e) => startDrag(e, "resize", h)} />}
                </div>
              );
            })}
            {temp && temp.id === null && (
              <div className="fm-hs is-sel" style={{ left: `${temp.box[0] * 100}%`, top: `${temp.box[1] * 100}%`, width: `${temp.box[2] * 100}%`, height: `${temp.box[3] * 100}%` }} />
            )}
            {chooser && (
              <div className="fm-chooser" style={{ left: `${(chooser.h.box[0] + chooser.h.box[2]) * 100}%`, top: `${chooser.h.box[1] * 100}%` }} onMouseDown={(e) => e.stopPropagation()}>
                <div className="fm-section-title">"{chooser.h.label}" leads to…</div>
                {chooser.edges.map((e) => (
                  <button key={e.id} onClick={() => follow(e)}>
                    <b>{byId.get(e.to)?.label}{e.to_variant ? ` (${e.to_variant})` : ""}</b>
                    <small>{e.condition ? `if ${e.condition}` : "always"}{e.inferred ? " · inferred" : ""}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          {msg && <div className="fm-lb-msg">{msg}</div>}
        </div>

        <aside className="fm-lb-side">
          {walk && flow && curStep && (
            <div className="fm-walk" data-testid="walkthrough">
              <div className="fm-section-title">Journey · {flow.name}</div>
              <div className="fm-player-controls">
                <button className="fm-btn" onClick={() => props.goTo(step - 1)}><Icon name="prev" size={15} /></button>
                <button className="fm-btn fm-btn-primary" onClick={() => {
                  if (!props.playing && step >= flow.steps.length - 1) props.goTo(0);
                  props.setPlaying(!props.playing);
                }}><Icon name={props.playing ? "pause" : "play"} size={15} /></button>
                <button className="fm-btn" onClick={() => props.goTo(step + 1)}><Icon name="next" size={15} /></button>
                <span className="fm-step-count">Step {step + 1} / {flow.steps.length}</span>
              </div>
              <p className="fm-walk-desc">{curStep.description}</p>
              {curStep.evidence?.req && (
                <div className="fm-walk-req" onClick={() => props.onReq(curStep.evidence!.req!)}>
                  <span className="fm-req-chip">{curStep.evidence.req}</span> {reqText.get(curStep.evidence.req)?.text}
                </div>
              )}
              {flow.steps[step + 1] && <p className="fm-muted">Next: {flow.steps[step + 1].description}{pulse ? ` (use the pulsing "${hotspots.find((h) => h.id === pulse)?.label ?? pulse}")` : ""}</p>}
              <button className="fm-btn fm-btn-ghost" onClick={() => { setStack([{ s: n.id, v: cur.v }]); setWalk(false); }}>Leave walkthrough and explore freely</button>
            </div>
          )}
          {!walk && flow && !props.prototype && (
            <button className="fm-btn fm-btn-text fm-walk-resume" onClick={() => setWalk(true)}>▶ Resume journey "{flow.name}"</button>
          )}

          <div className="fm-lb-title">{n.label}{variant ? <span className="fm-muted"> · {variant.label ?? variant.state}</span> : null}</div>
          <div className="fm-badges">
            {(n.actors ?? []).map((a) => <span key={a} className="fm-chip">{graph.actors?.find((x) => x.id === a)?.label ?? a}</span>)}
            <span className="fm-chip">{variant?.state ?? n.state ?? "default"}</span>
            {n.entry && <span className="fm-chip c-ok">entry screen</span>}
            <span className="fm-chip">{cur.v ? variant?.image : n.image}</span>
          </div>
          {editMode ? (
            <div className="fm-form">
              <TextField value={n.label} onCommit={(v) => updScreen({ label: v || n.label })} />
              <TextField multiline value={n.purpose ?? ""} placeholder="Purpose" onCommit={(v) => updScreen({ purpose: v })} />
              <TextField value={(n.actors ?? []).join(", ")} placeholder="actors (comma separated ids)" onCommit={(v) => updScreen({ actors: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
              <label className="fm-check"><input type="checkbox" checked={!!n.entry} onChange={(e) => updScreen({ entry: e.target.checked || undefined })} /> Entry screen</label>
            </div>
          ) : n.purpose && <p className="fm-summary">{n.purpose}</p>}

          {!!findings.length && (
            <>
              <div className="fm-section-title">Findings</div>
              {findings.map((f) => (
                <div key={f.id} className={`fm-finding sev-${f.severity ?? "high"}`}>
                  <b>{f.type.replace("_", " ")}{f.req ? ` · ${f.req}` : ""}</b>
                  <div>{f.text}</div>
                  {f.srs_says && <div className="fm-muted">SRS: {f.srs_says}</div>}
                  {f.screen_shows && <div className="fm-muted">Screen: {f.screen_shows}</div>}
                </div>
              ))}
            </>
          )}

          <div className="fm-section-title">Requirements ({n.requirements?.length ?? 0})</div>
          <ul className="fm-req-list">
            {(n.requirements ?? []).map((r) => (
              <li key={r.id}>
                <span className={`fm-req-chip c-${r.confidence ?? "high"}`} onClick={() => props.onReq(r.id)}>{r.id}</span>
                <div>
                  <div>{reqText.get(r.id)?.text ?? "(unknown requirement)"}</div>
                  {r.reason && <div className="fm-muted">Why: {r.reason} · {r.confidence ?? "high"} confidence</div>}
                </div>
                {editMode && <button className="fm-btn fm-btn-sm" onClick={() => updScreen({ requirements: (n.requirements ?? []).filter((x) => x.id !== r.id) })}>✕</button>}
              </li>
            ))}
          </ul>
          {editMode && (
            <select className="fm-input" value="" onChange={(e) => e.target.value && updScreen({ requirements: [...(n.requirements ?? []), { id: e.target.value, confidence: "med", reason: "linked by reviewer" }] })}>
              <option value="">+ Link a requirement…</option>
              {(graph.requirements ?? []).filter((r) => !n.requirements?.some((x) => x.id === r.id)).map((r) => <option key={r.id} value={r.id}>{r.id}: {r.text.slice(0, 60)}</option>)}
            </select>
          )}

          {editMode && selected ? (
            <div className="fm-form fm-hs-form" data-testid="hotspot-form">
              <div className="fm-section-title">Hotspot</div>
              <TextField value={selected.label} onCommit={(v) => updHs(selected.id, { label: v || selected.label })} />
              <select className="fm-input" value={selected.kind} onChange={(e) => updHs(selected.id, { kind: e.target.value })}>
                {HOTSPOT_KINDS.map((k) => <option key={k}>{k}</option>)}
              </select>
              <label className="fm-check"><input type="checkbox" checked={!!selected.in_place} onChange={(e) => updHs(selected.id, { in_place: e.target.checked || undefined })} /> Acts in place (no navigation)</label>
              <div className="fm-section-title">Leads to</div>
              {outEdges(selected.id).map((e) => (
                <div key={e.id} className="fm-dest">
                  <select className="fm-input" value={e.to} onChange={(ev) => updEdge(e.id, { to: ev.target.value })}>
                    {screens.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <TextField value={e.condition ?? ""} placeholder="condition (optional)" onCommit={(v) => updEdge(e.id, { condition: v })} />
                  <label className="fm-check"><input type="checkbox" checked={!!e.confirmed}
                    onChange={(ev) => updEdge(e.id, ev.target.checked ? { confirmed: true, inferred: undefined, reason: undefined, confidence: "high" } : { confirmed: undefined })} /> Confirmed</label>
                  <button className="fm-btn fm-btn-sm" title="Remove this link" onClick={() => edit((g) => { g.edges = g.edges.filter((x) => x.id !== e.id); })}>✕</button>
                </div>
              ))}
              <select className="fm-input" value="" data-testid="hs-link" onChange={(e) => e.target.value && linkHs(selected, e.target.value)}>
                <option value="">+ Link to a screen…</option>
                {screens.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <div className="fm-form-actions">
                {outEdges(selected.id)[0] && <button className="fm-btn fm-btn-ghost" onClick={() => go(outEdges(selected.id)[0].to)}>Follow ▸</button>}
                <button className="fm-btn fm-btn-danger" onClick={() => deleteHs(selected.id)}>Delete hotspot</button>
              </div>
            </div>
          ) : (
            <>
              <div className="fm-section-title">Controls ({hotspots.length})</div>
              <ul className="fm-hs-list">
                {hotspots.map((h) => {
                  const es = outEdges(h.id);
                  return (
                    <li key={h.id} onMouseEnter={() => setHover(h.id)} onMouseLeave={() => setHover(null)} onClick={() => clickHotspot(h)}
                      className={dead.has(h.id) ? "is-dead" : ""}>
                      <span>{h.label}</span>
                      <small>{es.length ? es.map((e) => byId.get(e.to)?.label).join(" / ") : h.in_place ? "in place" : h.kind === "field" ? "field" : "⚠ nowhere"}</small>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
