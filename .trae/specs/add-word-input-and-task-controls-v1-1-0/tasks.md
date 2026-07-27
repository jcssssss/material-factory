# Tasks

- [x] Task 1: 接入 Word → PDF 转换能力
  - [x] SubTask 1.1: 在 Rust 侧实现 LibreOffice 安装检测命令（`check_libreoffice`），返回是否可用与可执行路径
  - [x] SubTask 1.2: 在 Rust 侧实现 Word → PDF 转换命令（`convert_word_to_pdf`），调用 `soffice --headless --convert-to pdf`，支持超时与失败返回
  - [x] SubTask 1.3: 在前端 `inputValidation.ts` 放宽输入校验，允许 `.pdf` 与 `.docx`/`.doc` 共存，其他格式仍拒绝
  - [x] SubTask 1.4: 在 `taskRunner.ts` 中新增 Word→PDF 预处理阶段，调用转换命令后将 PDF 路径替换原 Word 路径进入 v1.0 链路
  - [x] SubTask 1.5: 在工作台检测 LibreOffice 缺失时阻止含 Word 任务启动并显式提示，纯 PDF 任务不受影响
  - [x] SubTask 1.6: 处理 Word 转换失败的场景：记录失败原因、将该 Word 视为失败 PDF 工作项、继续同任务其他文件

- [x] Task 2: 扩展任务状态机与运行时控制
  - [x] SubTask 2.1: 在 `src/types/task.ts` 中扩展 `TaskStatus`，新增 `paused` 与 `cancelled`，并定义状态迁移规则
  - [x] SubTask 2.2: 在 `useTaskStore.ts` 中实现 `pauseTask`、`resumeTask`、`cancelTask` 三个 action，校验状态迁移合法性
  - [x] SubTask 2.3: 在 `taskRunner.ts` 中引入可中断的执行循环：在每个 PDF 与每页边界检查暂停/取消信号
  - [x] SubTask 2.4: 暂停时等待当前页完成再停止调度，已完成的页与 PDF 结果保留
  - [x] SubTask 2.5: 取消时终止当前处理并标记 `cancelled`，已导出文件保留不回滚
  - [x] SubTask 2.6: 在 `TaskQueueTable.tsx` 与 `TaskProgressPanel.tsx` 中增加暂停/继续/取消按钮，并按状态控制可用性

- [x] Task 3: 实现 PDF 级断点恢复
  - [x] SubTask 3.1: 在 `persistence.ts` 中扩展持久化结构，新增 PDF 级进度断点字段（已完成 PDF 索引、未完成 PDF 列表、最后更新时间）
  - [x] SubTask 3.2: 在 `taskRunner.ts` 中每个 PDF 完成后写入断点，保证应用意外退出后断点可读
  - [x] SubTask 3.3: 应用启动时扫描本地持久化，识别状态为 `paused` 或异常退出的 `running` 任务
  - [x] SubTask 3.4: 在 `WorkbenchPage.tsx` 顶部展示“检测到 N 个未完成任务”提示与“继续 / 放弃”按钮
  - [x] SubTask 3.5: 实现“继续”恢复：加载断点、跳过已完成 PDF、从下一个 PDF 起始页继续执行
  - [x] SubTask 3.6: 实现“放弃”恢复：将任务标记为 `cancelled`，保留已导出文件与历史记录

- [x] Task 4: 更新文档与端到端验证
  - [x] SubTask 4.1: 更新 `产品需求文档-小红书素材工厂.md` 中 9.1/9.2 章节，将 v1.1.0 新增能力从“后续可扩展方向”迁移到“当前版本”
  - [x] SubTask 4.2: 更新 `技术架构文档-小红书素材工厂.md`，补充 Word→PDF 转换链路、运行时控制信号、断点持久化结构
  - [x] SubTask 4.3: 验证 Word→PDF→图片完整链路（单个 Word、Word+PDF 混合、LibreOffice 缺失、转换失败）
  - [x] SubTask 4.4: 验证运行时控制（暂停在页边界生效、继续从断点执行、取消后状态正确且文件保留）
  - [x] SubTask 4.5: 验证断点恢复（任务中途退出、重启检测未完成任务、继续/放弃两种分支）
  - [x] SubTask 4.6: 回归 v1.0 纯 PDF 串行队列与导出规格不受影响

# Task Dependencies

- `Task 2` depends on `Task 1`（Word 预处理需在执行循环中接入）
- `Task 3` depends on `Task 2`（断点持久化依赖扩展后的状态机与执行循环）
- `Task 4` depends on `Task 1`、`Task 2`、`Task 3`
- `Task 1` 内部：SubTask 1.1 → 1.2 → 1.4；SubTask 1.3 可与 1.1/1.2 并行；SubTask 1.5/1.6 依赖 1.4
- `Task 2` 内部：SubTask 2.1 → 2.2 → 2.3 → 2.4/2.5 → 2.6
- `Task 3` 内部：SubTask 3.1 → 3.2 → 3.3 → 3.4；SubTask 3.5/3.6 依赖 3.4
