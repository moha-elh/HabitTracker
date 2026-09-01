import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed dev-server port and quiet output.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Allow importing the shared design tokens from the repo root (../.. from apps/desktop).
    fs: { allow: [".", "../.."] },
  },
});
