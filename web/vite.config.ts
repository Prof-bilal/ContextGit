import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { rendererCsp } from "./shared/security";

const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [react(), {
    name: "contextgit-csp",
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: rendererCsp(command === "serve") }, injectTo: "head-prepend" }];
    },
  }],
  resolve: {
    // Single React instance: the renderer always resolves React from desktop's
    // dependency tree, regardless of other packages in the repository.
    alias: [
      { find: /^react$/, replacement: path.join(here, "node_modules/react") },
      { find: /^react\/(.*)$/, replacement: path.join(here, "node_modules/react/$1") },
      { find: /^react-dom$/, replacement: path.join(here, "node_modules/react-dom") },
      { find: /^react-dom\/(.*)$/, replacement: path.join(here, "node_modules/react-dom/$1") },
      { find: /^@\/(.*)$/, replacement: path.join(here, "$1") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [here, path.resolve(here, "../website/app/globals.css")] },
    watch: { ignored: ["**/build/**"] },
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
