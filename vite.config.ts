import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app is static: no server, no bundled libraries. libraries/, oracle/, reference/ and examples/ are
// never imported by src/app, and the dev server refuses to serve them, so ASHRAE tables cannot leak into
// a build or a page (decisions-web-app.md, "before step 5").
export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true,
    fs: { deny: [".env", ".env.*", "libraries/**", "oracle/**", "reference/**", "_archive/**", "examples/**"] },
  },
  build: { outDir: "dist", emptyOutDir: true },
  worker: { format: "es" },
});
