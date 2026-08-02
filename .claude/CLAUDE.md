# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

小红书素材工厂 — 完全本地执行的桌面 PDF 批量转图片工具（Tauri v2 + React + Rust）。支持 Word 输入转换、资料列表图生成、仿打印图片合成。去水印/文档清理后端（Rust + Python 双引擎）已实现并注册，前端页面待完成。

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

# Python 去水印引擎 (cd tools/document_cleaning_engine)
pip install -r requirements.txt  # PyMuPDF / lxml / python-docx
python -m pytest                 # 引擎测试；-m integration 仅跑端到端
python cli.py detect <pdf>       # 手动调用 CLI，stdout 输出 JSON
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
│   ├── taskRunner.ts     # 串行队列执行器（三级失败隔离）+ setProgress 节流
│   ├── taskController.ts # 运行时暂停/继续/取消的状态机
│   ├── pdfPageProcessor.ts # PDF 页处理器（pdf.js 渲染 + 流水线预取 + 编码 Worker）
│   ├── encodeWorker.ts   # 共享编码 Worker（OffscreenCanvas 合成 + JPEG 编码，移出主线程）
│   ├── progressThrottle.ts # setProgress 节流（高频进度合并到 ~10Hz）
│   ├── exportImage.ts    # 3:4 JPG 合成 + 150 DPI 元数据 + 二进制写盘
│   ├── pageRule.ts       # 页码规则解析器
│   ├── printEngine/      # 仿打印图片合成（warp + multiply + 二进制 body）
│   ├── materialList/     # 资料列表图生成
│   └── persistence.ts    # localStorage 持久化（历史 + 断点）
├── store/useTaskStore.ts # 单一 Zustand store
├── types/task.ts         # 任务领域类型 + 状态机定义
├── pages/                # 5 个路由页面
├── components/           # UI 组件（task/background/common）
└── routes/index.tsx      # 路由定义（HashRouter）

src-tauri/src/
├── main.rs               # 程序入口（tauri::Builder + 事件循环）
├── lib.rs                # Tauri 命令注册（文件读写/日志/Word 转换）
├── db.rs                 # SQLite（rusqlite, WAL, 背景模板 CRUD）
├── warp.rs               # DLT 透视变形（手写高斯消元 + 双线性插值）
├── background.rs         # 背景文件管理（文件存储 + 数据库）
├── watermark.rs          # 去水印/页眉/页脚（lopdf 纯逻辑 + 薄命令层）
└── python_bridge.rs      # subprocess 调用 tools/ 下 Python CLI，JSON 回传
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
- 图片尺寸: 1242×1656 (8.25"×11" @ 150 DPI, 3:4 竖版)
- JPG 质量 100%，JFIF APP0 段嵌入 150 DPI 元数据
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
- **lopdf 0.34** 用于 watermark.rs 解析/改写 PDF 内容流（文本/Image/Form XObject、/Annots）。
- 权限错误检查: macOS TCC (`Operation not permitted`)、Windows (`Access is denied`)。

## 去水印 / 文档清理（进行中）

- **双引擎并存**：`watermark.rs`（Rust + lopdf，覆盖 /Annots、Form XObject、文本/图片水印、页眉/页脚 y 阈值）与 `tools/document_cleaning_engine/`（Python + PyMuPDF，`detect`/`clean`/`validate` 三个子命令）。两套命令都已注册在 `invoke_handler`。
- **Rust 桥接**：`python_bridge.rs` 用 `python3` subprocess 调用 `cli.py`；路径按 `DOC_CLEANER_CLI` 环境变量 → 相对路径 → 可执行文件同级 依次解析。CLI 约定：stdout 承载 JSON 数据，stderr 承载日志。
- **Python 引擎**：依赖见 `requirements.txt`（PyMuPDF、lxml、python-docx）；测试用 pytest，端到端用例打 `-m integration` 标记。
- **前端状态**：路由 `/watermark-removal` 已注册但 `disabled: true`，`DocumentCleanerPage` 尚未实现。接手时先补前端页面，再决定双引擎去留。

## 测试规范

- 前端测试: vitest + @testing-library/react + jsdom。mock Tauri invoke（`vi.mock('@tauri-apps/api/core')`）。
- Rust 测试: 标准 `#[cfg(test)] mod tests`。数据库测试用临时目录 + 原子计数器避免冲突。
- e2e 测试: Playwright（需 Tauri 环境配合）。

## 新增 Tauri 命令步骤

1. 在 `src-tauri/src/lib.rs`（或新文件）添加 `#[command] fn xxx(...)`。
2. 在 `lib.rs::run()` 的 `invoke_handler` 中注册。
3. 在前端通过 `import { invoke } from "@tauri-apps/api/core"` 调用。

## CI/CD 与发布

- **CI（`.github/workflows/ci.yml`）**：push/PR 到 main 触发。frontend job（ubuntu）跑 `npx tsc --noEmit` + `npx vitest run`；backend job 装齐 Tauri Linux 系统依赖后跑 `cargo test`（失败时以 `::error` 注释输出诊断）。`-D warnings` 开启，任何告警都会导致编译失败。
- **发布（`.github/workflows/release.yml`）**：推送 `v*` tag 触发。macos-14 打 Intel x86_64 dmg，windows-2022 打 msi + NSIS exe；`softprops/action-gh-release` 自动建 Release 并上传，`generate_release_notes: true`。
- **捆绑 LibreOffice**：构建前 `bash scripts/prepare-libreoffice.sh` 下载对应平台 LibreOffice 到 `vendor/libreoffice/`（gitignore，不入库）。`find_libreoffice`（lib.rs）优先查捆绑目录，再回退系统路径 + PATH。注意：捆绑路径查找仅 macos/windows 有 cfg 分支，改此函数别破坏 Linux 编译。
- **版本号三处同步**：`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`frontend/package.json` 的 `version` 保持一致，且与 tag 号一致（历史上 package.json 曾落后）。
- **发版流程**：本地验证 → 三处升版本号 → 提交推 main 等 CI 绿 → `git tag vX.Y.Z && git push origin vX.Y.Z`。

## 依赖信息

### 前端
- pdfjs-dist ^3.11（当前 API: `getDocument()` 返回 `PDFDocumentProxy`）
- zustand ^5.0（无 provider，`create()` + `useTaskStore.getState()` 模式）
- @tauri-apps/api ^2.1, @tauri-apps/plugin-dialog ^2.7

### 后端
- tauri 2, tauri-plugin-dialog 2
- rusqlite 0.31 (bundled SQLite)
- image 0.24 (jpeg + png features)
- lopdf 0.34（watermark.rs 解析/改写 PDF 内容流）
- serde 1 + serde_json 1
- rayon 1 + num_cpus 1（并行处理）
- Python 引擎依赖见 tools/document_cleaning_engine/requirements.txt
