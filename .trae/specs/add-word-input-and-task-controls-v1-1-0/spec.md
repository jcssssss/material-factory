# v1.1.0 Word 输入与任务运行时控制 Spec

## Why
v1.0 已完成 PDF 批量转小红书素材的稳定链路，但实际运营场景中商品资料常以 Word（.docx/.doc）形式提供，用户被迫手工转 PDF 再上传，破坏了“一个任务对应一个商品”的连贯体验。
此外，v1.0 的“任务一旦启动只能等其结束”和“应用重启后不自动恢复”的策略在长任务（数十个 PDF、上千页）场景下体验差，用户无法应对临时打断、错误重试、机器关机等情况。
v1.1.0 需要在不动摇 v1.0 输出规格的前提下，补齐 Word 输入、任务运行时控制和 PDF 级断点恢复三项能力。

## What Changes
- 新增 Word 文档（.docx/.doc）输入支持，先通过 LibreOffice 无头模式转换为 PDF，再复用 v1.0 的 PDF 导出链路
- 新增 LibreOffice 安装检测与缺失提示，应用启动时主动校验
- 新增任务运行时控制：暂停（pause）、继续（resume）、取消（cancel）
- 新增 PDF 级断点恢复能力：记录任务内每个 PDF 的完成状态，应用重启后可从断点继续
- 新增任务恢复入口：启动时检测未完成任务并提供“继续/放弃”选择
- **MODIFIED** 任务状态机：在 v1.0 五态基础上新增 `paused`、`cancelled` 两个状态
- **MODIFIED** 本地持久化层：在 v1.0 任务元数据基础上新增进度断点字段（已完成 PDF 索引、未完成 PDF 列表）
- **MODIFIED** “首版仅支持 PDF”约束：放宽为“支持 PDF 与 Word，Word 走转换中转”
- **MODIFIED** “应用重启后不自动恢复未完成队列”约束：放宽为“提供恢复入口，由用户确认后从断点继续”
- **BREAKING** 任务数据结构 `TaskConfig` 增加 `sourceType: "files" | "folder"` 兼容 Word 来源，并新增进度断点字段（向后兼容 v1.0 已持久化数据）

## Impact
- Affected specs: `build-desktop-pdf-task-exporter`（首版能力边界、任务状态机、本地持久化、首版仅支持 PDF）
- Affected code:
  - `src-tauri/src/lib.rs`、`src-tauri/src/main.rs`、`src-tauri/Cargo.toml`（新增 LibreOffice 检测与转换命令、断点持久化目录）
  - `src/lib/taskRunner.ts`（增加暂停/继续/取消信号、Word→PDF 预处理、断点续跑）
  - `src/lib/persistence.ts`（保存/读取 PDF 级断点）
  - `src/lib/pdf.ts`（接受转换后的 PDF 路径）
  - `src/lib/inputValidation.ts`（放宽对 .docx/.doc 的校验）
  - `src/store/useTaskStore.ts`（状态机扩展、恢复入口）
  - `src/types/task.ts`（数据结构变更）
  - `src/components/task/TaskQueueTable.tsx`、`TaskProgressPanel.tsx`（控制按钮、paused/cancelled 展示）
  - `src/pages/WorkbenchPage.tsx`（LibreOffice 缺失提示、恢复入口）

## ADDED Requirements

### Requirement: Word 文档输入与转换中转
系统 SHALL 接受 Word 文档（.docx/.doc）作为任务输入，并在进入 PDF 处理链路前先转换为 PDF；转换结果写入临时缓存目录，原 Word 文件不被修改。

#### Scenario: 单个 Word 文件输入
- **WHEN** 用户为一个任务选择单个 .docx 或 .doc 文件
- **THEN** 系统将其标记为 Word 来源，并在执行前调用 LibreOffice 转换为 PDF
- **AND** 转换后的 PDF 路径替换原 Word 路径进入 v1.0 的 PDF 处理链路

#### Scenario: Word 与 PDF 混合输入
- **WHEN** 用户为一个任务同时选择 Word 与 PDF 文件
- **THEN** 系统对 Word 文件执行转换，对 PDF 文件直接复用，最终汇成统一的 PDF 输入集合
- **AND** 输出目录仍按“原文件名”组织子目录，不因转换中转混淆来源

#### Scenario: LibreOffice 未安装
- **WHEN** 用户尝试执行包含 Word 文件的任务但系统未检测到 LibreOffice
- **THEN** 系统阻止任务开始执行
- **AND** 在工作台显式提示“未检测到 LibreOffice，请先安装后再使用 Word 输入”
- **AND** 不影响纯 PDF 任务的正常执行

#### Scenario: Word 转 PDF 失败
- **WHEN** LibreOffice 转换某个 Word 文件失败或超时
- **THEN** 系统记录该 Word 文件的失败原因，将其视为该任务中的一个失败 PDF 工作项
- **AND** 继续处理同任务中其他 Word 或 PDF 文件，不中断队列

### Requirement: 任务运行时控制
系统 SHALL 支持对 `running` 状态的任务执行暂停、继续、取消三种运行时控制，且控制可在页级或 PDF 级边界生效。

#### Scenario: 暂停正在执行的任务
- **WHEN** 用户对 `running` 任务点击“暂停”
- **THEN** 系统在当前页或当前 PDF 边界停止后续处理
- **AND** 任务状态切换为 `paused`，已完成的页与 PDF 结果保留
- **AND** 当前正在渲染的页完成后不再调度下一页

#### Scenario: 继续已暂停的任务
- **WHEN** 用户对 `paused` 任务点击“继续”
- **THEN** 系统从最近完成的 PDF 与页之后继续执行
- **AND** 任务状态切换回 `running`

#### Scenario: 取消正在执行或暂停的任务
- **WHEN** 用户对 `running` 或 `paused` 任务点击“取消”
- **THEN** 系统终止当前处理，任务状态切换为 `cancelled`
- **AND** 已导出的文件保留在输出目录，不回滚
- **AND** 取消后的任务不可再被“继续”，仅可作为历史记录查看

#### Scenario: 控制按钮的可用性
- **WHEN** 任务处于 `pending`、`completed`、`completed_with_errors`、`failed`、`cancelled`
- **THEN** “暂停”按钮不可用
- **AND** “继续”按钮仅在 `paused` 状态可用
- **AND** “取消”按钮仅在 `running` 或 `paused` 状态可用

### Requirement: PDF 级断点恢复
系统 SHALL 在任务执行过程中持久化 PDF 级进度断点，并在应用重启后提供恢复入口。

#### Scenario: 断点持久化
- **WHEN** 任务执行过程中某个 PDF 完成全部页的导出
- **THEN** 系统将该 PDF 标记为已完成并持久化到本地
- **AND** 即使应用意外退出，下次启动时仍可读取该任务的已完成 PDF 列表

#### Scenario: 启动时检测未完成任务
- **WHEN** 应用启动并完成初始化
- **THEN** 系统扫描本地持久化中状态为 `paused` 或因异常退出的 `running` 任务
- **AND** 在工作台顶部展示“检测到 N 个未完成任务，是否继续？”提示与“继续 / 放弃”按钮

#### Scenario: 从断点继续
- **WHEN** 用户点击“继续”恢复一个未完成任务
- **THEN** 系统加载该任务的进度断点，跳过已完成的 PDF
- **AND** 从下一个未完成 PDF 的起始页继续执行
- **AND** 任务状态切换回 `running`，输出目录沿用原配置

#### Scenario: 放弃未完成任务
- **WHEN** 用户点击“放弃”放弃恢复
- **THEN** 系统将任务状态标记为 `cancelled`（或 `failed`，视原状态而定）
- **AND** 保留已导出文件与历史记录，不再进入恢复队列

## MODIFIED Requirements

### Requirement: 首版能力边界（扩展为 v1.1.0 能力边界）
v1.1.0 系统 SHALL 在 v1.0 能力边界基础上支持 Word 输入与任务运行时控制，但仍不要求支持云端同步、账号系统、模板编辑器、多尺寸导出或并发任务执行。

#### Scenario: 用户期望并发执行多个任务
- **WHEN** 用户在 v1.1.0 中加入多个任务
- **THEN** 系统仍按串行队列执行，而非并发执行

#### Scenario: 用户期望直接编辑 Word 内容
- **WHEN** 用户希望在工作台中修改 Word 文档内容
- **THEN** 系统不支持该能力，仅支持 Word→PDF 的转换中转与导出

### Requirement: 任务状态机
v1.1.0 系统 SHALL 在 v1.0 五态（`pending`、`running`、`completed`、`completed_with_errors`、`failed`）基础上新增 `paused` 与 `cancelled` 两个状态，并明确状态迁移规则。

#### Scenario: 状态迁移合法性
- **WHEN** 任务处于 `running` 状态
- **THEN** 允许迁移到 `paused`、`cancelled`、`completed`、`completed_with_errors`、`failed`
- **AND** 不允许直接迁移到 `pending`

- **WHEN** 任务处于 `paused` 状态
- **THEN** 允许迁移到 `running`（继续）或 `cancelled`
- **AND** 不允许直接迁移到 `completed`

- **WHEN** 任务处于 `cancelled`、`completed`、`completed_with_errors`、`failed`
- **THEN** 该任务视为终态，不再迁移

### Requirement: 本地持久化与日志
v1.1.0 系统 SHALL 在 v1.0 持久化内容基础上，额外持久化每个任务的 PDF 级进度断点，用于断点恢复。

#### Scenario: 持久化内容扩展
- **WHEN** 任务执行过程中产生 PDF 级完成事件
- **THEN** 系统持久化：任务 ID、PDF 路径、完成状态、已完成页码集合、最后更新时间
- **AND** 该断点独立于 v1.0 的任务结果摘要，便于恢复时快速读取

#### Scenario: 应用重启后查看历史
- **WHEN** 用户关闭应用后再次打开
- **THEN** 系统保留 v1.0 的最近任务元数据和日志
- **AND** 额外展示“可恢复任务”入口（仅当存在未完成任务时）

## REMOVED Requirements

### Requirement: 首版仅支持 PDF
**Reason**: v1.1.0 已通过 LibreOffice 中转支持 Word 输入，原约束不再适用。
**Migration**: 将“仅支持 PDF”的描述更新为“支持 PDF 与 Word（.docx/.doc），Word 走 LibreOffice 转换中转”；输入校验从“拒绝非 PDF”改为“拒绝非 PDF 且非 Word”。

### Requirement: 应用重启后不自动恢复未完成队列
**Reason**: v1.1.0 引入 PDF 级断点与恢复入口，原约束被替换。
**Migration**: 将“不自动恢复”更新为“启动时检测未完成任务并提示用户确认是否从断点继续”；用户未确认前不自动开始执行。
