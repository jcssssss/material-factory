import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vitest 配置：Task 7 单元测试。
// 使用 jsdom 环境提供 Canvas / document / localStorage 等 DOM API，
// 让 exportImage、persistence、taskRunner 等模块可在 Node 中测试。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // 真实 Canvas 渲染在 jsdom 中不可用，相关测试用 mock 覆盖。
    environmentOptions: {
      jsdom: {
        // 确保 toBlob 等 API 在测试中可被 mock。
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/mockPageProcessor.ts"],
    },
  },
});
