import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(root, "./"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3100,
    proxy: {
      "/api/v1": {
        target: process.env.API_ORIGIN || "http://127.0.0.1:8081",
        changeOrigin: true,
      },
      "/ws/v1/live": {
        target: process.env.API_ORIGIN || "http://127.0.0.1:8081",
        ws: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 3100,
  },
});
