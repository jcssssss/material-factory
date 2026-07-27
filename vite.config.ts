import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tauri 期望前端开发服务器运行在固定端口，且静态资源使用相对路径。
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri 部署后从 file:// 协议加载，必须使用相对路径。
  base: "./",
  // Tauri CLI 通过 TAURI_DEV_HOST 注入主机地址（移动端 / 远程设备调试）。
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // 忽略 Rust 侧变更，避免无意义的重启。
      ignored: ["**/src-tauri/**", "**/dist/**", "**/node_modules/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // pdfjs-dist v4 使用 top-level await，需要 es2022+ 支持。
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  },
});
