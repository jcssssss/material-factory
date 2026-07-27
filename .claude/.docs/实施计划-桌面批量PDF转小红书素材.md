## 摘要

本项目将实现一个完全本地执行的桌面应用，基于 `Tauri + React + TypeScript` 构建，用于按“任务=一个商品”批量处理 PDF 资料，并自动导出小红书图片素材。

首版范围聚焦在 PDF：
- 一个任务对应一个商品目录。
- 一个任务可输入单个 PDF、多个 PDF，或一个包含多个 PDF 的文件夹。
- 图片生成规则先采用“1 页 PDF 转 1 张图片”。
- 导出前可配置“前 N 页”与“自定义页码/页码范围”。
- 任务队列按顺序自动执行；单任务失败不阻塞后续任务。
- 输出按任务目录划分，导出为 `DPI=300`、`JPG 质量=100%`、固定 `3:4` 竖版图片。
- 保留最近任务、执行状态与错误日志。

## 当前状态分析

- 当前仓库为空实现状态，仅存在两份前期文档：
  - [产品需求文档-小红书素材工厂.md](file:///Users/shijichang/Documents/trae_projects/xhs_pic/.trae/documents/产品需求文档-小红书素材工厂.md)
  - [技术架构文档-小红书素材工厂.md](file:///Users/shijichang/Documents/trae_projects/xhs_pic/.trae/documents/技术架构文档-小红书素材工厂.md)
- 现有文档偏向“桌面优先 Web 工具”，与最新目标“完全本地桌面应用、任务队列、按商品目录批处理、高质量 JPG 导出”存在方向偏差。
- 仓库中尚无源代码、构建配置、测试文件或运行脚本，因此实现阶段需要从零初始化桌面端与前端工程。
- 当前最关键的架构变化：
  - 从 Web 工具调整为桌面应用。
  - 从通用内容卡片生成调整为“任务驱动的批量 PDF 页转图”。
  - 从在线 API/服务式处理调整为完全本地执行与本地持久化。

## 假设与决策

- 应用形态：采用 `Tauri v2 + React + TypeScript + Vite`。
- 平台目标：优先支持 macOS 本地运行；目录与权限设计兼容 Windows。
- 输入范围：首版仅支持 PDF；Word 支持明确延期。
- 任务模型：一个任务对应一个商品；一个商品可关联多个 PDF 文件；也支持直接选择一个文件夹并自动扫描其中 PDF。
- 页面转换：首版严格按“PDF 每页转一张图”，不做 OCR、摘要、智能排版、封面自动设计。
- 页码配置：同时支持“前 N 页”和“自定义页码/页码范围”，自定义规则优先级高于前 N 页。
- 输出规格：JPG，质量 100%，DPI 300，固定 3:4 竖版。
- 图片策略：为满足固定 `3:4` 输出，采用“页面等比缩放 + 居中放置 + 背景补边”的画布合成方式，避免裁切正文。
- 批处理策略：串行任务队列；单页失败记录错误并继续同任务后续页；单任务完成后自动开始下一个任务。
- 持久化策略：完全本地；保存最近任务、任务输入参数、输出目录、执行状态与错误日志。
- 日志策略：同时记录应用级日志和任务级日志；日志文件写入应用数据目录，并在界面中提供查看入口。
- 首版不包含：
  - 云端同步
  - 账号系统
  - Word 转 PDF
  - 模板编辑器
  - 多尺寸导出
  - 并发任务执行

## 方案总览

### 1. 技术栈

- 桌面壳：`src-tauri`
- 前端：`React + TypeScript + Vite + Tailwind CSS`
- 状态管理：`Zustand`
- 表单校验：`React Hook Form + Zod`
- 路由：`React Router`
- 本地持久化：
  - 最近任务元数据：前端本地存储或 Tauri Store
  - 运行日志与任务日志：Rust 侧文件写入
- PDF 渲染：
  - 前端使用 `pdf.js` 读取页数与页面内容
  - 导出阶段优先采用前端渲染到 `canvas`，再通过 Tauri 保存为高质量图片
- 原生能力：
  - 文件/目录选择
  - 路径解析
  - 输出目录创建
  - 日志落盘

### 2. 核心数据流

1. 用户创建任务，选择单个 PDF、多个 PDF，或商品文件夹。
2. 系统扫描并过滤出合法 PDF 文件，按文件名排序建立任务清单。
3. 用户设置导出规则：
   - 输出目录
   - 前 N 页
   - 自定义页码/范围
   - JPG 输出规格固定显示：300 DPI、质量 100%、3:4 竖版
4. 系统将任务加入队列并开始串行执行。
5. 执行每个任务时：
   - 解析文件列表
   - 计算应导出的 PDF 页码
   - 对每一页渲染到高分辨率画布
   - 合成到 3:4 输出画布
   - 导出 JPG 到该任务独立文件夹
   - 记录页级成功/失败日志
6. 当前任务结束后自动进入下一任务。
7. 全部任务完成后展示汇总结果、失败任务数、失败页数，并允许查看错误日志。

### 3. 关键接口与状态模型

- `TaskConfig`
  - `taskId`
  - `taskName`
  - `sourceType`: `files | folder`
  - `sourcePaths`
  - `outputDir`
  - `pageRuleMode`: `firstN | custom | combined`
  - `firstN`
  - `customPages`
  - `status`: `pending | running | completed | completed_with_errors | failed`

- `PdfWorkItem`
  - `taskId`
  - `pdfPath`
  - `pdfName`
  - `totalPages`
  - `selectedPages`

- `PageResult`
  - `taskId`
  - `pdfPath`
  - `pageNumber`
  - `status`: `success | failed | skipped`
  - `outputPath`
  - `errorMessage`

- `TaskSummary`
  - `taskId`
  - `totalPdfCount`
  - `totalPageCount`
  - `successPageCount`
  - `failedPageCount`
  - `startedAt`
  - `finishedAt`

### 4. 页码规则

- 输入支持：
  - 单页：`1,3,8`
  - 范围：`2-5`
  - 混合：`1,3-6,9`
- 解析规则：
  - 去重
  - 自动升序
  - 忽略超出 PDF 总页数的页码并记录警告日志
  - 非法输入阻止任务开始，并在表单区提示
- 当同时配置“前 N 页”和“自定义页码”时：
  - 合并后去重
  - 最终以合法页码集合执行

### 5. 输出目录与命名

- 根输出目录由用户选择。
- 每个任务输出到独立目录：
  - `输出根目录/{任务名或商品名}/`
- 若一个任务内有多个 PDF，再按 PDF 文件名分组：
  - `输出根目录/{任务名}/{PDF文件名}/`
- 图片命名规则：
  - `001.jpg`
  - `002.jpg`
  - 或 `PDF文件名_p001.jpg`
- 最终实施采用更稳妥的命名：
  - 多 PDF 场景：`{pdfBaseName}_p{页码三位}.jpg`
  - 单 PDF 场景：同样沿用统一规则，减少分支复杂度

## 拟修改文件

### 文档

- `/.trae/documents/产品需求文档-小红书素材工厂.md`
  - 将产品定位从 Web 工具修订为桌面应用。
  - 重写核心流程、页面结构、输入模型、任务队列、日志和导出规则。

- `/.trae/documents/技术架构文档-小红书素材工厂.md`
  - 将架构从“前后端服务式”修订为 `Tauri + React` 本地桌面架构。
  - 重写路由、状态模型、本地持久化、导出链路与错误处理。

### 工程初始化

- `/package.json`
  - 定义前端依赖、脚本、构建命令。

- `/vite.config.ts`
  - 配置 Vite 与 Tauri 开发联动。

- `/tsconfig.json`
  - 定义 TypeScript 编译选项。

- `/tailwind.config.ts`
  - 配置桌面端 UI 所需主题令牌。

- `/postcss.config.js`
  - 支持 Tailwind 构建。

- `/index.html`
  - Vite 前端入口。

- `/src-tauri/Cargo.toml`
  - 定义 Tauri/Rust 依赖与插件。

- `/src-tauri/tauri.conf.json`
  - 配置应用名、窗口、权限、打包选项。

- `/src-tauri/src/main.rs`
  - Tauri 程序入口。

- `/src-tauri/src/commands.rs`
  - 暴露原生命令：选择目录、写日志、创建输出目录、保存图片等。

- `/src-tauri/src/logging.rs`
  - 实现应用日志与任务日志落盘。

### 前端页面与组件

- `/src/main.tsx`
  - React 挂载入口。

- `/src/App.tsx`
  - 全局布局与路由壳。

- `/src/routes/index.tsx`
  - 路由定义：工作台、任务详情、日志查看。

- `/src/pages/WorkbenchPage.tsx`
  - 主工作台：创建任务、添加文件/文件夹、配置导出参数、启动队列。

- `/src/pages/HistoryPage.tsx`
  - 最近任务列表、状态、输出目录、重新执行入口。

- `/src/pages/LogViewerPage.tsx`
  - 错误日志与任务执行日志查看。

- `/src/components/task/TaskForm.tsx`
  - 任务配置表单。

- `/src/components/task/TaskQueueTable.tsx`
  - 队列表格、状态、进度、失败数展示。

- `/src/components/task/PageRuleInput.tsx`
  - 前 N 页与自定义页码规则输入。

- `/src/components/task/TaskProgressPanel.tsx`
  - 当前任务、当前 PDF、当前页进度展示。

- `/src/components/common/FilePickerButton.tsx`
  - 选择单文件、多文件、文件夹。

- `/src/components/common/EmptyState.tsx`
  - 空状态展示。

- `/src/components/common/StatusBadge.tsx`
  - 队列状态徽标。

### 前端状态与核心逻辑

- `/src/store/useTaskStore.ts`
  - 保存任务队列、执行状态、最近任务、错误摘要。

- `/src/types/task.ts`
  - 任务、页码规则、日志、结果类型定义。

- `/src/lib/pageRule.ts`
  - 页码解析、归一化、合法性校验。

- `/src/lib/pdf.ts`
  - 读取 PDF 页数、逐页渲染、高分辨率导出辅助函数。

- `/src/lib/exportImage.ts`
  - 实现 3:4 画布合成、JPG 导出参数控制、文件命名。

- `/src/lib/taskRunner.ts`
  - 串行执行队列，封装任务级和页级失败不中断逻辑。

- `/src/lib/persistence.ts`
  - 最近任务、本地配置、上次输出目录持久化。

- `/src/lib/logger.ts`
  - 前端事件日志收集，并桥接到 Rust 落盘。

### 样式

- `/src/styles/index.css`
  - 全局样式、桌面工作台主题、表格与表单风格。

## 详细实现步骤

### 第 1 步：修正文档并初始化工程

- 更新现有 PRD 与技术架构文档，确保与桌面应用方向一致。
- 初始化 `Vite + React + TypeScript + Tailwind + Tauri` 项目骨架。
- 配置基础脚本：
  - `dev`
  - `build`
  - `tauri dev`
  - `tauri build`

### 第 2 步：搭建桌面工作台 UI

- 实现工作台主页面：
  - 任务列表
  - 添加任务
  - 文件/文件夹选择
  - 页码规则配置
  - 输出目录选择
  - 执行按钮
- 实现历史任务和日志查看页面。

### 第 3 步：实现任务模型与队列

- 定义任务状态机：
  - `pending`
  - `running`
  - `completed`
  - `completed_with_errors`
  - `failed`
- 实现串行队列执行器。
- 保证单任务结束自动调度下一个任务。

### 第 4 步：实现 PDF 解析与页码筛选

- 接入 `pdf.js` 读取总页数。
- 为每个 PDF 生成待处理页集合。
- 对非法页码、空页集合、损坏 PDF 做前置校验与错误提示。

### 第 5 步：实现高分辨率图片导出

- 计算满足 300 DPI 的 3:4 目标画布尺寸。
- 每页 PDF 渲染为高分辨率源图。
- 将源图等比缩放后合成到目标 3:4 画布。
- 导出为 JPG 质量 100%。
- 通过 Tauri 原生命令写入本地磁盘。

### 第 6 步：实现日志与任务历史

- 为应用运行、任务开始/结束、页级成功/失败分别打点。
- 日志文件按日期或任务分文件存储。
- UI 中提供查看最近任务与错误日志能力。

### 第 7 步：完善异常处理与体验

- 文件夹无 PDF 时阻止执行。
- PDF 某页导出失败时继续下一页。
- 单 PDF 失败时继续同任务其他 PDF。
- 单任务失败时继续下一任务。
- 所有任务结束后展示汇总弹层或结果页。

## 失败模式与处理

- 文件不存在或被移动：
  - 标记任务失败，写入日志，继续后续任务。
- PDF 解析失败：
  - 标记该 PDF 失败，继续同任务其他 PDF。
- 指定页码超范围：
  - 记录警告，忽略非法页码。
- 全部页码均非法：
  - 当前 PDF 跳过并记录错误。
- 输出目录不可写：
  - 当前任务失败，继续后续任务。
- 单页渲染或保存失败：
  - 记录页级失败并继续下一页。
- 应用关闭重开：
  - 保留最近任务元数据和日志，但不自动恢复未完成执行。

## 验证步骤

### 静态验证

- 检查 TypeScript 类型错误。
- 检查 Rust 编译错误。
- 检查 Tauri 配置是否可正常启动开发环境。

### 功能验证

- 单任务单 PDF：
  - 选择 1 个 PDF，配置页码后成功导出图片。
- 单任务多 PDF：
  - 同一任务内 2 个以上 PDF 顺序处理并正确命名。
- 多任务批处理：
  - 3 个以上任务串行执行，前一任务结束后自动开始下一任务。
- 页码规则：
  - 验证 `前 N 页`、`自定义页码`、`混合配置` 三种情况。
- 错误不中断：
  - 人为放入损坏 PDF，确认错误被记录且后续任务继续执行。
- 输出目录：
  - 确认按任务目录与 PDF 文件名规则生成。

### 输出质量验证

- 校验导出图片为 JPG。
- 校验 JPG 质量参数为 100%。
- 校验目标尺寸符合 3:4 竖版。
- 校验导出元数据或换算结果满足 300 DPI 目标。

## 验收标准

- 用户可在桌面应用中创建多个任务并加入队列。
- 每个任务可接受单个 PDF、多个 PDF 或一个包含多个 PDF 的文件夹。
- 执行前可配置前 N 页与自定义页码/范围。
- 队列按顺序自动执行，无需人工逐个点击开始。
- 任一页、任一 PDF、任一任务失败都不会阻塞后续队列。
- 所有错误都可在界面中查看，并能定位到具体任务/PDF/页码。
- 输出目录按任务隔离，图片命名稳定且可追踪。
- 导出结果为固定 3:4 竖版 JPG，质量 100%，目标 300 DPI。

## 实施备注

- 实现阶段应优先确保“稳定批处理 + 正确导出 + 清晰日志”，而不是额外增加编辑器、智能排版或 Word 支持。
- 若后续确认需要支持 Word，建议采用“先本地转 PDF，再复用相同页转图链路”的方式扩展，避免维护双套渲染逻辑。

## V1.2.0 阶段：资料列表展示图生成器

v1.2.0 在 v1.0/v1.1 完成的 PDF/Word 转图链路基础上，新增独立的「资料列表展示图生成器」能力。该能力读取商品资料文件夹的真实目录结构，自动生成白底 1242×1656 文件列表展示图，替代人工打开网盘截图的流程，并支持多商品批量生成。

### V1.2.0 范围

- 新增 Rust 命令 `scan_folder_tree`：递归扫描商品资料文件夹，过滤系统文件，返回目录树结构。
- 新增前端 `src/lib/materialList/` 模块：目录扫描封装、文件类型图标、布局引擎（排序/分页/编号）、Canvas 图片渲染器、任务执行器。
- 新增独立的资料列表任务模型与执行器，与 PDF 任务流水线并存且互不干扰。
- 新增 `MaterialListPage` 页面与 `/material-list` 路由，导航栏扩展为四 Tab。
- 复用 v1.0/v1.1 的 `ensure_output_dir`、`write_image_file`、`append_log_line` 基础能力。
- 不修改 v1.0/v1.1 的 PDF 任务流水线、状态机、断点恢复逻辑。
- 不包含百度网盘真实截图、Finder UI 模拟、模板编辑器（MVP 限制）。

### V1.2.0 任务拆分

| 任务 | 内容 | 依赖 |
|------|------|------|
| Task 1 | Rust `scan_folder_tree` 递归扫描命令，过滤系统文件，返回 `FolderTreeNode` | - |
| Task 2 | 前端 `src/types/materialList.ts` 类型与 `folderScanner.ts` 扫描封装 | Task 1 |
| Task 3 | `iconAssets.ts` 文件类型图标资源（PDF/Word/Excel/PPT/文件夹/通用） | 独立，可并行 |
| Task 4 | `layoutEngine.ts` 排序（文件夹优先）、分页（25 项/页）、统一编号格式化 | Task 2 |
| Task 5 | `imageRenderer.ts` Canvas 渲染白底 1242×1656 图片 | Task 3、Task 4 |
| Task 6 | `materialListRunner.ts` 任务执行器：扫描→深度优先遍历→分页渲染→写盘→编号 | Task 1-5 |
| Task 7 | `useMaterialListStore.ts` 独立 store，历史持久化到 `xhs-pic:material-list-history` | Task 2 |
| Task 8 | `MaterialListPage.tsx` 页面与组件、`/material-list` 路由、导航栏 Tab | Task 6、Task 7 |
| Task 9 | 同步更新 `.trae/documents/` 三份主文档 | Task 1-8 |
| Task 10 | `materialList/__tests__/` 单元测试与端到端验证 | Task 1-9 |

### V1.2.0 验收标准

- 输入商品目录后自动生成列表图片，文件名称与真实目录一致。
- 文件夹层级正确，子文件夹独立生成图片。
- 支持批量商品处理，单商品失败不影响批处理。
- 图片为白色背景、文件图标正确、文件名称完整显示、无额外营销文字、尺寸符合 1242×1656。
- 错误写入日志，输出目录结构正确。
- v1.0/v1.1 的 PDF 任务流水线、状态机、断点恢复逻辑未受影响。
- 既有 100 个单元测试全部通过，新增测试全部通过。
- `npx tsc --noEmit`、`cargo check`、`npm run build` 全部通过。
