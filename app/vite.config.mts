import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { outDir: "../dist", emptyOutDir: true },
});
