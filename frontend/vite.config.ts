import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tauri 期望前端开发服务器运行在固定端口，且静态资源使用相对路径。
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // pdf.js 渲染未嵌入的中文 CID 字体需要 CMap/标准字体资源：
    // 构建时把 pdfjs-dist 自带资源复制进产物，运行时用相对路径加载（file:// 兼容）。
    // tesseract.js 本地 OCR（扫描版试卷转文字）：worker 脚本 + WASM 核心 + 中英文训练数据。
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/pdfjs-dist/cmaps/*",
          dest: "pdfjs/cmaps",
        },
        {
          src: "node_modules/pdfjs-dist/standard_fonts/*",
          dest: "pdfjs/standard_fonts",
        },
        {
          src: "node_modules/tesseract.js/dist/worker.min.js",
          dest: "tesseract",
        },
        {
          // 所有核心变体（含 SIMD）一并复制，worker 按设备能力自动选择
          src: "node_modules/tesseract.js-core/tesseract-core*.wasm*",
          dest: "tesseract",
        },
        {
          src: "node_modules/@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz",
          dest: "tesseract/lang",
        },
        {
          src: "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
          dest: "tesseract/lang",
        },
      ],
    }),
  ],
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
      ignored: ["../src-tauri/**", "**/dist/**", "**/node_modules/**"],
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
