# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# 开发
npm run dev              # Vite dev server (port 5173)
npm run tauri:dev        # Tauri 桌面应用开发模式

# 构建
npm run build            # tsc + vite build (前端)
npm run tauri:build      # Tauri 生产构建

# 测试
npm run test             # vitest run
npm run test:watch       # vitest watch
npm run test:coverage    # vitest run --coverage
npx vitest run src/lib/__tests__/pageRule.test.ts  # 单文件测试

# 其它
npm run tauri            # tauri CLI
```

## 架构概览

### 核心工作流: PDF → 3:4 JPG

```
用户配置任务 → runQueue (串行) → openPdfs → 逐页渲染 → export JPG → 后处理
```

- **taskRunner.ts**: 串行队列执行器，失败隔离（页面级→PDF级→任务级），断点恢复
- **pageProcessor.ts** / **pdfPageProcessor.ts**: 负责展开PDF列表、加载文档、渲染导出
- **taskController.ts**: 运行时暂停/继续/取消的状态机，供 UI 绑定
- **exportImage.ts**: 2475×3300 画布，等比缩放居中，嵌入 300 DPI JFIF 元数据

### 后处理（可选）

1. **资料列表图** (`src/lib/materialList/`): 扫描目录树 → 分页（每页25项）→ 1242×1656 Canvas 渲染
2. **仿打印图片** (`src/lib/printEngine/`): 从已标定背景模板中随机选 → Rust warp 透视变形 → multiply 混合合成

### 前端

- React 18 + react-router-dom 6 (HashRouter) + Zustand 5 + Tailwind 3
- 路由: `/` 工作台, `/history` 历史, `/logs` 日志, `/backgrounds` 背景模板, `/calibrate/:id` 透视标定
- **Store** (`src/store/useTaskStore.ts`): 单一 Zustand store 管理全部状态

### Tauri 后端 (Rust)

- `lib.rs`: 命令注册 — 文件读写(`read_pdf_bytes` 走二进制通道避免 JSON 开销)、扫描目录、LibreOffice Word 转换、日志操作
- `db.rs`: SQLite (rusqlite bundled)，WAL 模式，表: `tasks`/`page_results`/`logs`/`breakpoints`/`backgrounds`
- `warp.rs`: 完整手写高斯消元法解 DLT 计算单应性矩阵，双线性插值，反向映射
- `background.rs`: 背景文件 CRUD，文件存 `{app_data_dir}/backgrounds/files/`

### 关键约束

- PDF 渲染通过 `pdfjs-dist` v3.11 在浏览器端完成（不是 Rust 端）
- 大文件通过 `invoke<ArrayBuffer>` 二进制通道读取，避免 JSON 编码开销
- 日志同时写入内存（Zustand）和磁盘 JSONL 文件（通过 Rust 命令）
- 断点存储在 localStorage（PDF 级别），重启后可恢复
- Word 文件依赖 LibreOffice (`soffice`) 转为 PDF 后再处理
- 输出 JPG 尺寸: 2475×3300 (8.25"×11" @ 300 DPI)
