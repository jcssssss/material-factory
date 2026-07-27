# Tasks

- [x] Task 1: Rust 递归扫描命令 `scan_folder_tree`
  - [x] SubTask 1.1: 在 `src-tauri/src/lib.rs` 新增 `scan_folder_tree(folder: String) -> Result<FolderTreeNode, String>` 命令，递归扫描目录树
  - [x] SubTask 1.2: 在扫描中过滤系统文件（`.DS_Store`、`Thumbs.db`、`desktop.ini`、`__MACOSX`），并对无法读取元数据的文件跳过并记 warn 日志
  - [x] SubTask 1.3: 节点结构包含 `name`、`path`、`is_dir`、`extension`、`file_type`（pdf/word/excel/ppt/folder/other）、`empty`（仅文件夹）、`children`（仅文件夹）
  - [x] SubTask 1.4: 在 `invoke_handler!` 中注册 `scan_folder_tree`
  - [x] SubTask 1.5: 运行 `cargo check` 验证编译

- [x] Task 2: 前端领域类型与 Rust 命令封装
  - [x] SubTask 2.1: 新增 `src/types/materialList.ts`，定义 `FolderTreeNode`、`FileType`、`MaterialListTaskConfig`、`MaterialListTaskStatus`、`MaterialListTaskRunResult`、`MaterialListHistoryTask` 等类型
  - [x] SubTask 2.2: 新增 `src/lib/materialList/folderScanner.ts`，封装 `@tauri-apps/api/core` 的 `invoke('scan_folder_tree', { folder })` 调用，返回类型化的 `FolderTreeNode`
  - [x] SubTask 2.3: 运行 `npx tsc --noEmit` 验证类型

- [x] Task 3: 文件类型图标资源
  - [x] SubTask 3.1: 新增 `src/lib/materialList/iconAssets.ts`，内联 5 类 SVG 图标字符串（PDF/Word/Excel/PPT/文件夹/通用文件），每个图标设计为统一的视觉风格与尺寸（如 64×64 视口）
  - [x] SubTask 3.2: 提供 `getIconForFileType(fileType: FileType): string` 函数返回对应 SVG 字符串
  - [x] SubTask 3.3: 提供 `svgStringToImage(svg: string): Promise<HTMLImageElement>` 工具函数，将 SVG 字符串转为可在 Canvas 绘制的 Image 对象

- [x] Task 4: 布局引擎与排序分页
  - [x] SubTask 4.1: 新增 `src/lib/materialList/layoutEngine.ts`，定义 `LayoutItem`（icon + name + isDir）与 `LayoutPage`（items 数组）
  - [x] SubTask 4.2: 实现 `sortDirectoryChildren(children: FolderTreeNode[]): FolderTreeNode[]`，文件夹优先、同类按名称升序（不区分大小写）
  - [x] SubTask 4.3: 实现 `paginateChildren(children: FolderTreeNode[], maxItemsPerPage = 25): LayoutPage[]`，将排序后的子项分配到多个分页
  - [x] SubTask 4.4: 实现 `formatImageFilename(index: number, total: number): string`，返回 `资料列表_01.jpg` 形式，支持 ≥99 时三位零填充

- [x] Task 5: Canvas 图片渲染器
  - [x] SubTask 5.1: 新增 `src/lib/materialList/imageRenderer.ts`，定义常量 `MATERIAL_IMAGE_WIDTH = 1242`、`MATERIAL_IMAGE_HEIGHT = 1656`、`BACKGROUND_COLOR = "#ffffff"`
  - [x] SubTask 5.2: 实现 `renderLayoutPageToCanvas(page: LayoutPage): Promise<HTMLCanvasElement>`，绘制白底画布，逐项绘制图标（左）与文件名（右），垂直排列
  - [x] SubTask 5.3: 实现 `canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 1.0): Promise<Blob>`，复用 v1.0 JPEG 质量规范
  - [x] SubTask 5.4: 处理文件名过长时按可用宽度截断并添加省略号

- [x] Task 6: 资料列表任务执行器
  - [x] SubTask 6.1: 新增 `src/lib/materialList/materialListRunner.ts`，实现 `runMaterialListTask(task: MaterialListTaskConfig, callbacks): Promise<MaterialListTaskRunResult>`
  - [x] SubTask 6.2: 内部流程：对每个商品文件夹调用 `scanFolderTree` → 深度优先遍历目录树 → 对每个非空目录调用 `sortDirectoryChildren` + `paginateChildren` + `renderLayoutPageToCanvas` → 调用 `writeImageFile` 写入商品根目录
  - [x] SubTask 6.3: 实现统一编号逻辑：单个商品范围内图片编号从 `01` 起全局递增
  - [x] SubTask 6.4: 异常隔离：扫描失败、单目录渲染失败时记 error 日志并跳过，不影响后续目录或商品
  - [x] SubTask 6.5: 空文件夹处理：标记 `empty: true` 的目录不生成图片，记 warn 日志
  - [x] SubTask 6.6: 通过 `append_log_line` 写入结构化 JSONL 日志（scope: `material-list`，参考 v1.0 日志格式）

- [x] Task 7: 状态管理与持久化
  - [x] SubTask 7.1: 新增 `src/store/useMaterialListStore.ts`，参考 `useTaskStore.ts` 模式，管理任务队列与执行状态
  - [x] SubTask 7.2: 实现 `addTask`、`startQueue`、`updateTaskStatus`、`clearCompleted` 等 actions
  - [x] SubTask 7.3: 实现 localStorage 持久化：键 `xhs-pic:material-list-history`，最多 200 条，与 PDF 任务历史 `xhs-pic:history` 隔离
  - [x] SubTask 7.4: 实现 `loadHistoryFromStorage` 与 `saveHistoryToStorage` 工具函数

- [x] Task 8: 资料列表生成器页面与组件
  - [x] SubTask 8.1: 新增 `src/pages/MaterialListPage.tsx`，包含任务表单 + 队列表格 + 进度面板三段式布局，参考 `WorkbenchPage.tsx` 结构
  - [x] SubTask 8.2: 新增 `src/components/materialList/MaterialListTaskForm.tsx`：任务名输入、商品文件夹多选（复用 `FilePickerButton` 的文件夹选择能力）、加入队列按钮
  - [x] SubTask 8.3: 新增 `src/components/materialList/MaterialListQueueTable.tsx`：展示任务名、商品数、状态、操作（参考 `TaskQueueTable.tsx`）
  - [x] SubTask 8.4: 新增 `src/components/materialList/MaterialListProgressPanel.tsx`：展示当前任务、当前商品、已生成图片数、总进度（参考 `TaskProgressPanel.tsx`）
  - [x] SubTask 8.5: 在 `src/routes/index.tsx` 新增 `/material-list` 路由
  - [x] SubTask 8.6: 在 `src/App.tsx` 导航栏新增「资料列表」Tab，与现有「工作台」「历史记录」「日志」并列

- [x] Task 9: 项目主文档同步更新
  - [x] SubTask 9.1: 更新 `.trae/documents/产品需求文档-小红书素材工厂.md`：
    - 在产品概述章节同步「新增资料列表展示图生成器」能力
    - 新增「资料列表展示图生成器」功能模块章节，覆盖功能背景、用户价值、输入设计（仅选择商品文件夹）、核心业务规则（根目录不展示、当前目录展示、子文件夹独立生成、文件夹优先排序、文件类型图标）、图片生成规范（1242×1656 白底、垂直排列、自动分页）、输出规则（资料列表_NN.jpg 写入商品根目录）、异常处理（空文件夹、系统文件、读取失败）、MVP 限制
    - 在非目标章节同步「不包含百度网盘真实截图、Finder UI 模拟、模板编辑器」
    - 不改写 v1.0/v1.1 已有章节
  - [x] SubTask 9.2: 更新 `.trae/documents/技术架构文档-小红书素材工厂.md`：
    - 版本号从 v1.1.0 升级到 v1.2.0
    - 在总体架构 mermaid 图新增「资料列表生成器」分支（独立于 PDF 任务流水线）
    - 在模块划分表新增 `src/lib/materialList/` 子模块（folderScanner / layoutEngine / iconAssets / imageRenderer / materialListRunner）与 `src/store/useMaterialListStore.ts`
    - 在 Tauri 命令清单新增 `scan_folder_tree`（复用 `ensure_output_dir`、`write_image_file`、`append_log_line`）
    - 新增「资料列表渲染流水线」时序图：用户选择商品文件夹 → `scan_folder_tree` 递归扫描 → 深度优先遍历 → `sortDirectoryChildren` + `paginateChildren` → `renderLayoutPageToCanvas` → `writeImageFile` 统一编号写盘
    - 在本地持久化说明中新增 `xhs-pic:material-list-history` 键
    - 不改写 v1.0/v1.1 已有架构描述
  - [x] SubTask 9.3: 更新 `.trae/documents/实施计划-桌面批量PDF转小红书素材.md`：
    - 在实施阶段清单中追加「V1.2.0 阶段：资料列表展示图生成器」条目
    - 列出 9 个任务概要（Rust 命令、类型、图标、布局、渲染、执行器、Store、页面、测试）与依赖关系
    - 与 v1.0/v1.1 阶段并列，不改写已有阶段内容

- [x] Task 10: 单元测试与端到端验证
  - [x] SubTask 10.1: 新增 `src/lib/materialList/__tests__/layoutEngine.test.ts`，覆盖排序、分页、文件名格式化（≥99 升级三位）
  - [x] SubTask 10.2: 新增 `src/lib/materialList/__tests__/iconAssets.test.ts`，覆盖 5 类图标映射与未识别后缀回退
  - [x] SubTask 10.3: 新增 `src/lib/materialList/__tests__/materialListRunner.test.ts`，使用 mock `scanFolderTree` 与 `writeImageFile`，覆盖正常多级目录、空文件夹、单目录分页、单目录渲染失败隔离、批量商品失败隔离
  - [x] SubTask 10.4: 运行 `npm test`，确保新增测试全部通过且既有 100 个测试不受影响
  - [x] SubTask 10.5: 运行 `npx tsc --noEmit` 与 `cargo check`，确保编译通过
  - [x] SubTask 10.6: 运行 `npm run build`，确保前端构建成功

# Task Dependencies
- Task 2 依赖 Task 1（前端类型需对应 Rust 返回结构）
- Task 3 独立，可与 Task 1/2 并行
- Task 4 依赖 Task 2（需要 `FolderTreeNode` 类型）
- Task 5 依赖 Task 3 与 Task 4（需要图标资源与 `LayoutPage`）
- Task 6 依赖 Task 1/2/4/5（需要扫描、布局、渲染全链路）
- Task 7 依赖 Task 2（需要任务类型）
- Task 8 依赖 Task 6 与 Task 7（需要执行器与 store）
- Task 9 依赖 Task 1-8 全部完成（文档需反映最终实现结构）
- Task 10 依赖 Task 1-9 全部完成
