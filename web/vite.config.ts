/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8096", changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: "http://localhost:8096", changeOrigin: true },
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    // hls.js is lazy-loaded only for transcoded playback.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
