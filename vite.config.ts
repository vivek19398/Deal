import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  server: { host: "0.0.0.0" },
  build: { outDir: mode === "online" ? "dist-online" : "dist" },
}));
