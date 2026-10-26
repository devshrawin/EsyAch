// Mode B left-panel tabs: requirements (pick one to light up the screens/edges that satisfy it)
// and coverage (the gap report, live).
import { useMemo, useState } from "react";
import type { Coverage } from "./coverage";
import type { Graph } from "./types";

export function RequirementsTab({ graph, cov, reqFocus, setReqFocus, openScreen }: {
  graph: Graph; cov: Coverage; reqFocus: string | null; setReqFocus: (id: string | null) => void; openScreen: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const label = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.label])), [graph]);
  const reqs = (graph.requirements ?? []).filter((r) => !q || `${r.id} ${r.text} ${r.section ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="fm-form"><input className="fm-input" placeholder="Filter requirements…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ul className="fm-reqs" data-testid="req-list">
        {reqs.map((r) => {
          const screens = cov.reqScreens.get(r.id) ?? [];
          const edges = cov.reqEdges.get(r.id) ?? [];
          const status = r.ui === false ? "non-ui" : screens.length || edges.length ? "covered" : "missing";
          const finding = cov.findings.find((f) => f.req === r.id);
          return (
            <li key={r.id} className={reqFocus === r.id ? "is-active" : ""} onClick={() => setReqFocus(reqFocus === r.id ? null : r.id)} data-req={r.id}>
              <div className="fm-row">
                <span className="fm-req-chip">{r.id}</span>
                <span className={`fm-status s-${status}`}>{status === "covered" ? `${screens.length} screen${screens.length === 1 ? "" : "s"}` : status === "missing" ? "no screen" : "no UI"}</span>
              </div>
              <div className="fm-req-text">{r.text}</div>
              <div className="fm-flow-meta">
                {r.priority && <span>{r.priority}</span>}
                {r.section && <span>{r.section}</span>}
                {finding && <span className="c-bad">⚠ {finding.type.replace("_", " ")}</span>}
              </div>
              {reqFocus === r.id && (
                <div className="fm-req-links" onClick={(e) => e.stopPropagation()}>
                  {screens.map((s) => <button key={s} className="fm-chip-btn is-on" onClick={() => openScreen(s)}>{label.get(s)}</button>)}
                  {!!edges.length && <span className="fm-muted">{edges.length} transition{edges.length === 1 ? "" : "s"}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function CoverageTab({ graph, cov, openScreen, setReqFocus, selectFlow, showEdge }: {
  graph: Graph; cov: Coverage; openScreen: (id: string) => void; setReqFocus: (id: string) => void;
  selectFlow: (id: string) => void; showEdge: (id: string) => void;
}) {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const req = new Map((graph.requirements ?? []).map((r) => [r.id, r]));
  const pct = Math.round((100 * cov.covered.length) / Math.max(1, cov.total));
  const Sec = ({ title, n, sev, children }: { title: string; n: number; sev: "red" | "amber" | "ok"; children: React.ReactNode }) => (
    <div className={`fm-cov-sec sev-${n ? sev : "ok"}`}>
      <div className="fm-section-title fm-row"><span>{title}</span><span className="fm-cov-n">{n}</span></div>
      {n ? <ul className="fm-cov-list">{children}</ul> : <p className="fm-muted fm-cov-none">None</p>}
    </div>
  );
  return (
    <div className="fm-coverage" data-testid="coverage">
      <div className="fm-cov-meter">
        <div className="fm-row"><b>{cov.covered.length}/{cov.total} UI requirements have a screen</b><span>{pct}%</span></div>
        <div className="fm-meter"><span style={{ width: `${pct}%` }} /></div>
        <div className="fm-muted">{cov.nonUi.length} non-UI requirement(s) are not expected on a screen: {cov.nonUi.join(", ") || "none"}</div>
      </div>
      <Sec title="Contradictions" n={cov.findings.filter((f) => f.type === "contradiction").length} sev="red">
        {cov.findings.filter((f) => f.type === "contradiction").map((f) => (
          <li key={f.id} onClick={() => f.screen && openScreen(f.screen)} data-finding={f.id}>
            <b>{f.req}</b> · {label.get(f.screen ?? "")}: {f.text}
          </li>
        ))}
      </Sec>
      <Sec title="Requirements with no screen" n={cov.withoutScreen.length} sev="red">
        {cov.withoutScreen.map((r) => <li key={r} onClick={() => setReqFocus(r)} data-gap={r}><b>{r}</b> {req.get(r)?.text}</li>)}
      </Sec>
      <Sec title="Controls that lead nowhere" n={cov.deadHotspots.length} sev="amber">
        {cov.deadHotspots.map((h) => <li key={h.screen + h.hotspot} onClick={() => openScreen(h.screen)}>{label.get(h.screen)}: "{h.label}"</li>)}
      </Sec>
      <Sec title="Missing states / other findings" n={cov.findings.filter((f) => f.type !== "contradiction").length} sev="amber">
        {cov.findings.filter((f) => f.type !== "contradiction").map((f) => (
          <li key={f.id} onClick={() => f.screen && openScreen(f.screen)}><b>{f.type.replace("_", " ")}</b> {f.req} · {f.text}</li>
        ))}
      </Sec>
      <Sec title="Screens with no requirement" n={cov.screensWithoutReq.length} sev="amber">
        {cov.screensWithoutReq.map((s) => <li key={s} onClick={() => openScreen(s)}>{label.get(s)}</li>)}
      </Sec>
      <Sec title="Dead-end screens" n={cov.deadEnds.length} sev="amber">
        {cov.deadEnds.map((s) => <li key={s} onClick={() => openScreen(s)}>{label.get(s)}</li>)}
      </Sec>
      <Sec title="Unreachable screens" n={cov.unreachable.length} sev="red">
        {cov.unreachable.map((s) => <li key={s} onClick={() => openScreen(s)}>{label.get(s)}</li>)}
      </Sec>
      <Sec title="Inferred transitions to confirm" n={cov.inferred.length} sev="amber">
        {cov.inferred.map((id) => {
          const e = graph.edges.find((x) => x.id === id)!;
          return <li key={id} onClick={() => showEdge(id)}>{label.get(e.from)} → {label.get(e.to)} · {e.label}{e.reason ? <div className="fm-muted">{e.reason}</div> : null}</li>;
        })}
      </Sec>
      <div className="fm-cov-sec">
        <div className="fm-section-title">Journeys ({graph.flows.length})</div>
        <ul className="fm-cov-list">{graph.flows.map((f) => <li key={f.id} onClick={() => selectFlow(f.id)}>{f.name} <span className="fm-muted">· {f.actor}</span></li>)}</ul>
      </div>
    </div>
  );
}
