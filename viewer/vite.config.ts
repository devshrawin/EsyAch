import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds one self-contained HTML template (no CDN, no external assets).
// scripts/build.py injects the graph JSON into the #flowmap-data placeholder.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: "dist", assetsInlineLimit: 100_000_000, cssCodeSplit: false, reportCompressedSize: false, copyPublicDir: false },
});
