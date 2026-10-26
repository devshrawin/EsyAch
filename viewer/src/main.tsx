import "./template"; // must run first: snapshots the untouched page
import React from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import App from "./App";
import type { Graph } from "./types";

async function loadGraph(): Promise<Graph | null> {
  const text = document.getElementById("flowmap-data")?.textContent?.trim() ?? "";
  if (text.startsWith("{")) return JSON.parse(text) as Graph;
  if (import.meta.env.DEV) {
    const res = await fetch("/sample.json");
    return (await res.json()) as Graph;
  }
  return null;
}

loadGraph().then((graph) => {
  const root = createRoot(document.getElementById("root")!);
  if (!graph) {
    root.render(<div className="fm-empty">No flowmap data embedded. Build this file with scripts/build.py.</div>);
    return;
  }
  document.title = `${graph.project.name} · flowmap`;
  root.render(
    <React.StrictMode>
      <App graph={graph} />
    </React.StrictMode>,
  );
});
