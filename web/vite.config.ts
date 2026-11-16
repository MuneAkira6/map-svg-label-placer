import { defineConfig } from "vite";

// Served from https://muneakira6.github.io/map-svg-label-placer/ (GitHub Pages).
export default defineConfig({
  base: "/map-svg-label-placer/",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  worker: { format: "es" },
});
