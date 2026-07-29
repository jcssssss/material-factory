# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

小红书素材工厂 — 完全本地执行的桌面 PDF 批量转图片工具（Tauri v2 + React + Rust）。支持 Word 输入转换、资料列表图生成、仿打印图片合成。

## 开发命令

```bash
# 前端开发 (cd frontend)
npm run dev              # Vite dev server (port 5173)
npm run build            # tsc -b && vite build
npm run tauri:dev        # Tauri 桌面应用开发模式
npm run tauri:build      # Tauri 生产构建

# 测试
npm run test             # vitest run
npm run test:watch       # vitest watch (简写: vitest)
npm run test:coverage    # vitest run --coverage
npx vitest run --reporter=verbose src/lib/__tests__/xxx.test.ts  # 单文件调试

# e2e 测试 (Playwright)
npm run test:e2e         # playwright test
npm run test:e2e:ui      # playwright test --ui
npm run test:e2e:debug   # playwright test --debug

# Rust 后端 (cd src-tauri)
cargo build              # Rust 编译
cargo test               # Rust 单元测试
cargo check              # 类型检查（快速）
cargo test -- --nocapture # 测试带 stdout 输出
```

## 项目结构约定

新增所有代码必须放入对应的子目录，**禁止**在项目根目录下创建新目录：

| 代码性质 | 目录 |
|----------|------|
| 前端 UI、组件、页面、前端业务逻辑、前端测试 | `frontend/src/` |
| Tauri 命令、Rust 数据结构、SQLite 操作、后端测试 | `src-tauri/src/` |
| Python 工具脚本、独立分析引擎、批量处理脚本 | `tools/<module>/` |
| 项目配置文件、文档 | 根目录（仅限配置文件、文档） |

> 凡是不属于 `frontend/` 也不属于 `src-tauri/` 的辅助工具，统一放入 `tools/` 目录。

## 架构概览

```
frontend/src/
├── lib/                  # 核心业务逻辑
│   ├── taskRunner.ts     # 串行队列执行器（三级失败隔离）
│   ├── taskController.ts # 运行时暂停/继续/取消的状态机
│   ├── pdfPageProcessor.ts # PDF 页处理器（pdf.js 渲染）
│   ├── exportImage.ts    # 3:4 JPG 合成 + 300 DPI 元数据
│   ├── pageRule.ts       # 页码规则解析器
│   ├── printEngine/      # 仿打印图片合成（warp + multiply）
│   ├── materialList/     # 资料列表图生成
│   └── persistence.ts    # localStorage 持久化（历史 + 断点）
├── store/useTaskStore.ts # 单一 Zustand store
├── types/task.ts         # 任务领域类型 + 状态机定义
├── pages/                # 5 个路由页面
├── components/           # UI 组件（task/background/common）
└── routes/index.tsx      # 路由定义（HashRouter）

src-tauri/src/
├── lib.rs                # Tauri 命令注册（文件读写/日志/Word 转换）
├── db.rs                 # SQLite（rusqlite, WAL, 背景模板 CRUD）
├── warp.rs               # DLT 透视变形（手写高斯消元 + 双线性插值）
└── background.rs         # 背景文件管理（文件存储 + 数据库）
```

## 核心工作流

### 主流程：PDF → 3:4 JPG
```
用户配置 → runQueue(串行) → openPdfs → 逐页渲染(pdfjs-dist) → export 3:4 JPG → 写盘
                                             ↓ (可选后处理)
                                     资料列表图生成 → 仿打印合成(warp+multiply)
```

### 三级失败隔离
```
单页失败   → 记录页级错误，继续同 PDF 下一页
单 PDF 失败 → 记录 PDF 错误，继续同任务其他 PDF
单任务失败 → 记录任务错误，继续队列下一任务
```

### PDF 级断点恢复
每个 PDF 完成后写入 localStorage 断点，应用重启后可从断点继续未完成任务。

### 输出规格
- 图片尺寸: 2475×3300 (8.25"×11" @ 300 DPI, 3:4 竖版)
- JPG 质量 100%，JFIF APP0 段嵌入 300 DPI 元数据
- 页面比例不匹配时：等比缩放居中放置，白色补边

## 前端关键约定

- **React 18 + HashRouter + Zustand 5 + Tailwind 3**。无 UI 组件库，全部手写。
- **Zustand store** 单一 store (`useTaskStore`)，管理 queue/progress/logs/history/breakpoints/draft。不分区 slices。
- **PDF 渲染** 通过 `pdfjs-dist` v3.11 在浏览器端完成（非 Rust 端）。
- **大文件** 通过 `invoke<ArrayBuffer>` 二进制通道读取（`read_pdf_bytes`），避免 JSON 编码 5MB+ PDF。
- **日志** 同时写入内存（Zustand）和磁盘 JSONL（通过 Rust `append_log_line` / `read_log_file`）。
- **路由** HashRouter，5 个页面: `/` 工作台, `/history` 历史, `/logs` 日志, `/backgrounds` 背景模板, `/calibrate/:id` 透视标定。
- **TypeScript strict** 模式，`noUnusedLocals` / `noUnusedParameters` 开启。路径别名 `@/` → `src/`。
- **测试** vitest + jsdom + @testing-library/react。测试文件与源码放一起在 `__tests__/` 目录。

## 后端关键约定

- **Tauri v2**，命令通过 `#[command]` 注册在 `lib.rs::run()` 的 `invoke_handler` 中。
- **SQLite** (rusqlite bundled, WAL 模式) — 仅存储背景模板数据。tasks/page_results/logs 改用 JSONL 文件 + localStorage。
- **LibreOffice** 转换 Word → PDF（无头模式 `soffice --headless --convert-to pdf`），120 秒超时。
- **warp.rs** 完整手写 DLT 算法计算单应性矩阵（无 opencv 依赖），反向映射 + 双线性插值。
- 权限错误检查: macOS TCC (`Operation not permitted`)、Windows (`Access is denied`)。

## 测试规范

- 前端测试: vitest + @testing-library/react + jsdom。mock Tauri invoke（`vi.mock('@tauri-apps/api/core')`）。
- Rust 测试: 标准 `#[cfg(test)] mod tests`。数据库测试用临时目录 + 原子计数器避免冲突。
- e2e 测试: Playwright（需 Tauri 环境配合）。

## 新增 Tauri 命令步骤

1. 在 `src-tauri/src/lib.rs`（或新文件）添加 `#[command] fn xxx(...)`。
2. 在 `lib.rs::run()` 的 `invoke_handler` 中注册。
3. 在前端通过 `import { invoke } from "@tauri-apps/api/core"` 调用。

## 依赖信息

### 前端
- pdfjs-dist ^3.11（当前 API: `getDocument()` 返回 `PDFDocumentProxy`）
- zustand ^5.0（无 provider，`create()` + `useTaskStore.getState()` 模式）
- @tauri-apps/api ^2.1, @tauri-apps/plugin-dialog ^2.7

### 后端
- tauri 2, tauri-plugin-dialog 2
- rusqlite 0.31 (bundled SQLite)
- image 0.24 (jpeg + png features)
- serde 1 + serde_json 1
