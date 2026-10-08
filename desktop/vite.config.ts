import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { rendererCsp } from "./shared/security";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [react(), {
    name: "contextgit-csp",
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: rendererCsp(command === "serve") }, injectTo: "head-prepend" }];
    },
  }],
  resolve: {
    // Single React instance: shared components resolve react from the repo
    // root's node_modules, the renderer from desktop's — force one copy.
    alias: [
      { find: /^react$/, replacement: path.join(here, "node_modules/react") },
      { find: /^react\/(.*)$/, replacement: path.join(here, "node_modules/react/$1") },
      { find: /^react-dom$/, replacement: path.join(here, "node_modules/react-dom") },
      { find: /^react-dom\/(.*)$/, replacement: path.join(here, "node_modules/react-dom/$1") },
      { find: /^@\/(.*)$/, replacement: path.join(repoRoot, "$1") },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  // Monaco is only reached through a dynamic import, so without this Vite
  // discovers it late, re-optimizes, and restarts the server mid-scan.
  optimizeDeps: {
    include: ["monaco-editor"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  // Monaco ships its language services as ES-module web workers; bundling them
  // as ES (rather than the IIFE default) keeps them code-splittable.
  worker: {
    format: "es",
  },
}));
