import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/api/zlbb-solution": {
        target: "https://zlbb.faendir.com",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/zlbb-solution/, ""),
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            // Follow 301 redirect to GitHub Raw transparently
            if (proxyRes.statusCode === 301) {
              const loc = proxyRes.headers.location;
              if (loc) {
                proxyRes.headers.location = "/api/zlbb-redirect?" + encodeURIComponent(loc);
              }
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "../src/main/resources/static",
    emptyOutDir: true,
  },
});
