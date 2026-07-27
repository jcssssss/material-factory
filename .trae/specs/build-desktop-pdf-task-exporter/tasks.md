# Tasks

- [x] Task 1: 修正文档并初始化桌面工程
  - [x] SubTask 1.1: 统一需求文档、技术架构文档与本规格的桌面化口径
  - [x] SubTask 1.2: 初始化 `Tauri v2 + React + TypeScript + Vite + Tailwind CSS` 项目骨架
  - [x] SubTask 1.3: 配置 `dev`、`build`、`tauri dev`、`tauri build` 等基础脚本
  - [x] SubTask 1.4: 建立前端入口、路由壳层、全局样式和桌面窗口配置

- [x] Task 2: 搭建桌面工作台 UI
  - [x] SubTask 2.1: 实现工作台主页面与任务配置表单
  - [x] SubTask 2.2: 支持单个 PDF、多个 PDF 与文件夹选择
  - [x] SubTask 2.3: 实现输出目录选择、页码规则输入和执行按钮
  - [x] SubTask 2.4: 实现任务列表、状态徽标和队列控制区域
  - [x] SubTask 2.5: 实现历史任务页面与日志查看页面

- [x] Task 3: 实现任务模型与串行队列
  - [x] SubTask 3.1: 定义任务、PDF 工作项、页级结果和任务摘要的数据结构
  - [x] SubTask 3.2: 实现任务状态机：`pending`、`running`、`completed`、`completed_with_errors`、`failed`
  - [x] SubTask 3.3: 实现串行队列执行器和任务完成后自动调度下一任务
  - [x] SubTask 3.4: 落实单页失败不中断、单 PDF 失败不中断、单任务失败不中断

- [x] Task 4: 实现页码规则解析与输入校验
  - [x] SubTask 4.1: 支持前 N 页配置与合法性校验
  - [x] SubTask 4.2: 支持自定义页码与页码范围表达式解析
  - [x] SubTask 4.3: 实现两类规则合并、去重、升序和超范围页码告警
  - [x] SubTask 4.4: 实现非法表达式、空页集合、非 PDF 输入和空文件夹阻止执行

- [x] Task 5: 实现 PDF 解析与高质量图片导出
  - [x] SubTask 5.1: 接入 `pdf.js` 读取 PDF 页数并生成待处理页集合
  - [x] SubTask 5.2: 将 PDF 页面渲染为高分辨率源图
  - [x] SubTask 5.3: 合成固定 `3:4` 竖版输出画布，采用等比缩放、居中放置和背景补边
  - [x] SubTask 5.4: 导出 `JPG 质量 100%`、目标 `300 DPI` 的图片
  - [x] SubTask 5.5: 按任务目录、PDF 子目录和稳定命名规则写入本地磁盘

- [x] Task 6: 实现日志、本地持久化与结果查看
  - [x] SubTask 6.1: 记录应用级日志、任务级日志和页级错误日志
  - [x] SubTask 6.2: 持久化最近任务、任务输入参数、输出目录和执行状态
  - [x] SubTask 6.3: 在界面展示当前任务、当前 PDF、当前页和失败统计
  - [x] SubTask 6.4: 提供最近任务、输出目录和错误日志查看能力
  - [x] SubTask 6.5: 保证应用重启后保留历史记录，但不自动恢复未完成队列

- [x] Task 7: 完善异常处理、验证与稳定性修正
  - [x] SubTask 7.1: 处理文件不存在、PDF 解析失败、输出目录不可写等异常
  - [x] SubTask 7.2: 验证单任务单 PDF、单任务多 PDF 与多任务串行流程
  - [x] SubTask 7.3: 验证页码规则、错误不中断和输出目录命名
  - [x] SubTask 7.4: 验证导出格式、质量参数、`3:4` 比例和 `300 DPI` 目标

# Task Dependencies

- `Task 2` depends on `Task 1`
- `Task 3` depends on `Task 1` and `Task 2`
- `Task 4` depends on `Task 2`
- `Task 5` depends on `Task 3` and `Task 4`
- `Task 6` depends on `Task 3`
- `Task 7` depends on `Task 5` and `Task 6`
