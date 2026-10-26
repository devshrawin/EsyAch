// The page as served, captured before React renders into it. Re-embedding edited JSON into
// this string gives a new self-contained HTML ("Download HTML"). Empty in the dev server.
export const TEMPLATE: string = import.meta.env.DEV ? "" : document.documentElement.outerHTML;
