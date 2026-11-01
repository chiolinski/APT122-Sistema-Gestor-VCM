import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const headers = {
  "Content-Security-Policy": "default-src 'self'; connect-src 'self' http://127.0.0.1:10000 ws://127.0.0.1:5176; media-src 'self' blob: http://127.0.0.1:10000; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const proxy = { "/api": { target: "http://127.0.0.1:7076", changeOrigin: false } };
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5176, strictPort: true, headers, proxy },
  preview: { host: "127.0.0.1", port: 4176, strictPort: true, headers, proxy },
});
