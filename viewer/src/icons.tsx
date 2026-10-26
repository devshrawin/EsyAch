// Inline SVG icon set (lucide-style strokes, hand-copied; no icon font or CDN).
import type { GNode } from "./types";

const P: Record<string, JSX.Element> = {
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  atom: (
    <>
      <circle cx="12" cy="12" r="1.2" />
      <ellipse cx="12" cy="12" rx="10" ry="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
    </>
  ),
  server: (
    <>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <path d="M6 6h.01M6 18h.01" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  box: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2 10 5-10 5L2 7z" />
      <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h5" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  merge: (
    <>
      <path d="M8 6h3a4 4 0 0 1 4 4v8" />
      <path d="M8 18h3a4 4 0 0 0 4-4" />
      <path d="m12 15 3 3 3-3" />
      <circle cx="5" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
    </>
  ),
  code: <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />,
  cpu: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
    </>
  ),
  webhook: (
    <>
      <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
      <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
      <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </>
  ),
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  cog: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M6 3l14 9-14 9V3z" />,
  pause: <path d="M6 4h4v16H6zM14 4h4v16h-4z" />,
  next: <path d="M5 4l10 8-10 8V4zM19 5v14" />,
  prev: <path d="M19 20 9 12l10-8v16zM5 19V5" />,
  reset: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  fit: <path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  palette: (
    <>
      <path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2.3a2 2 0 0 0-1.5 3.3c.6.7.3 2.7-2.2 2.7Z" />
      <circle cx="7.5" cy="10.5" r="1.2" /><circle cx="10.5" cy="6.5" r="1.2" /><circle cx="15.5" cy="7" r="1.2" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  layout: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <path d="M10 6.5h4a2 2 0 0 1 2 2V14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
};

export function Icon({ name, size = 24, stroke = 1.8, className, style }: {
  name: string; size?: number; stroke?: number; className?: string; style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {P[name] ?? P.code}
    </svg>
  );
}

// tech -> [icon, color]; checked before the kind fallback.
const TECH: Record<string, [string, string]> = {
  react: ["atom", "#61dafb"], vue: ["code", "#42b883"], svelte: ["code", "#ff3e00"], angular: ["code", "#dd0031"],
  python: ["code", "#f5c542"], node: ["code", "#8cc84b"], go: ["code", "#00add8"], java: ["code", "#f89820"],
  http: ["globe", "#5ac8a8"], fastapi: ["globe", "#5ac8a8"], express: ["globe", "#5ac8a8"],
  postgres: ["database", "#5b9bd5"], mysql: ["database", "#4f9bb8"], sqlite: ["database", "#7fb3d5"],
  mongodb: ["database", "#58aa50"], redis: ["database", "#e5533d"], file: ["file", "var(--icon-neutral)"], s3: ["cloud", "#e8a33d"],
  stripe: ["card", "#8b7dff"], paypal: ["card", "#2f8fdc"], smtp: ["mail", "#e8a33d"], sendgrid: ["mail", "#3aa0e8"],
  cron: ["clock", "#e8a33d"], kafka: ["layers", "var(--icon-neutral)"], rabbitmq: ["layers", "#ff6600"],
  webhook: ["webhook", "#c86dd7"], openai: ["cpu", "#b8e0d2"], anthropic: ["cpu", "#d4a27f"],
};
const KIND: Record<string, [string, string]> = {
  entrypoint: ["globe", "#5ac8a8"], trigger: ["bolt", "#ff6d5a"], hub: ["cpu", "var(--icon-neutral)"], service: ["cog", "var(--icon-neutral)"],
  module: ["box", "var(--icon-neutral)"], datastore: ["database", "#5b9bd5"], external: ["cloud", "#b18cf5"], queue: ["layers", "#f0a33f"],
  ui: ["monitor", "#61dafb"], job: ["clock", "#f0a33f"], config: ["key", "var(--icon-neutral)"], util: ["wrench", "var(--icon-neutral)"],
  merge: ["merge", "var(--icon-neutral)"], screen: ["image", "var(--icon-neutral)"],
};

export function iconFor(n: Pick<GNode, "kind" | "tech">): { icon: string; color: string } {
  const t = n.tech ? TECH[n.tech.toLowerCase()] : undefined;
  const [icon, color] = t ?? KIND[n.kind] ?? ["code", "var(--icon-neutral)"];
  return { icon, color };
}
