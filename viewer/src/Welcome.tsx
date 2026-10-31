import { Icon } from "./icons";
import type { Flow, Graph } from "./types";

// A non-modal "Start here" card: what this map is, one button that plays the best flow, three tips.
// It never blocks the canvas, and it is remembered per project in localStorage (see App.tsx).

export function heroFlow(graph: Graph): Flow | undefined {
  return graph.flows.find((f) => f.kind === "happy") ?? graph.flows[0];
}

export function Welcome({ graph, onPlay, onClose }: { graph: Graph; onPlay: (f: Flow) => void; onClose: () => void }) {
  const spec = graph.mode === "spec";
  const hero = heroFlow(graph);
  const noun = spec ? "journeys" : "flows";
  const tips: [string, string][] = [
    ["Click any " + (spec ? "journey" : "flow"), "to step through it. Space plays, arrow keys step."],
    ["Press Ctrl+K", "to jump to any node, " + (spec ? "requirement" : "flow") + " or group."],
    [spec ? "Open the Coverage tab" : "Click a node or an edge", spec
      ? "for missing screens, contradictions and dead buttons."
      : "to see its file:line evidence and what it talks to."],
    ["Switch to Edit", "to fix anything that is wrong, then Save. Your edits survive the next analysis."],
  ];
  return (
    <div className="fm-welcome" role="dialog" aria-label="Start here" data-testid="welcome">
      <button className="fm-btn fm-btn-sm fm-welcome-x" onClick={onClose} title="Close" aria-label="Close"><Icon name="x" size={12} /></button>
      <div className="fm-welcome-kicker">Start here</div>
      <h2>{graph.project.name}</h2>
      <p className="fm-welcome-sum">
        {graph.project.summary ?? (spec
          ? "Every journey from the requirements, with the screens behind it."
          : "How the pieces of this system talk to each other, as named flows you can replay.")}
      </p>
      <div className="fm-welcome-stats">
        <span><b>{graph.nodes.length}</b> {spec ? "screens & states" : "nodes"}</span>
        <span><b>{graph.edges.length}</b> connections</span>
        <span><b>{graph.flows.length}</b> {noun}</span>
      </div>
      {hero && (
        <button className="fm-btn fm-btn-primary fm-welcome-play" onClick={() => onPlay(hero)} data-testid="welcome-play">
          <Icon name="play" size={14} /> Play “{hero.name}”
        </button>
      )}
      <ul className="fm-welcome-tips">
        {tips.map(([a, b]) => <li key={a}><b>{a}</b> {b}</li>)}
      </ul>
    </div>
  );
}
