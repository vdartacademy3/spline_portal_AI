// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    server: {
      port: 8081,
      strictPort: true,
      proxy: {
        "/api/": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
          configure(proxy) {
            proxy.on("proxyRes", (proxyRes, _req, res) => {
              if (proxyRes.statusCode !== 204) return;
              delete proxyRes.headers["content-length"];
              delete proxyRes.headers["transfer-encoding"];
              for (const [key, value] of Object.entries(proxyRes.headers)) {
                if (value !== undefined) res.setHeader(key, value);
              }
              res.writeHead(204);
              proxyRes.on("error", () => {});
              proxyRes.resume();
              res.end();
            });
          },
        },
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
