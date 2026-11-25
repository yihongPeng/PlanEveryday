# 每日网格甘特图实施计划

> **For agentic workers:** 使用 subagent-driven-development 分模块实现并复核。用户已批准重设计；本轮不提交、不发布、不操作屏幕。

**Goal:** 将已确认的每日日期格、任务双端伸缩、跨度内每日显示与统一导航图标落实到隔离验收版。

**Architecture:** 保留任务同一 ID 与 plannedDate（开始日），增加 plannedEndDate（结束日）。日期范围、重点和事务逻辑集中在数据层；界面只通过现有 IPC 写入。按现有 Store/UI 模块边界分工，继续使用当前工作区，不触碰正式库。

**Tech Stack:** 现有 Electron、原生 JS/CSS、SQLite、离线 SVG 图标；Playwright 无界面检查。

## 1. 数据范围与兼容

- [x] `src/store.cjs`、`src/project-model.cjs`、媒体/迁移模块：SQLite 格式 3、备份 v6；v1–v5 的单日任务补结束日为开始日，未排期两端空。迁移前完整备份，失败不改原库。
- [x] `scheduleTasks(ids,date)` 保持每项跨度；清空两端进入收集箱；重点归属日在新范围内才保留。阶段联动平移两个端点，完成项不移动，提醒不变。
- [x] 新接口 `scheduleTaskRange({id,startDate,endDate,expected})` 返回撤销凭据；`undoTaskRange(undo)` 冲突安全恢复端点和重点。`expected` 为界面读到的任务开始/结束日及 updatedAt，防止拖动覆盖并发修改。
- [x] 编写并运行范围/旧备份/存储失败/重点/提醒/冲突撤销测试：`npm.cmd test`。

## 2. 经典甘特图

- [x] `src/ui/gantt.js`、`gantt.css`：参考 `test-results/designs/classic-daily-gantt.html`，月表头＋每天日期/星期，固定名称与统一网格，细阶段汇总条，任务范围条。
- [x] 条身平移、两端缩放、日期输入、取消、边缘横滚、错误保留候选范围与重试。用 `onTaskSchedule` 回调提交；任务松开直接保存＋撤销，阶段仍预览确认。
- [x] 更新 `scripts/gantt-view-test.cjs`：日期格、对齐、双端拖动、跨月、隐藏取消、失败重试和极端日期。

## 3. 项目工作区

- [x] `src/ui/projects.js`、`projects.css`：甘特图新接口、轻量反馈/撤销、阶段预览显示任务两端、项目范围和范围外检测；继承同一任务的提醒/草稿/状态。
- [x] `scripts/project-workspace-test.cjs`：真实 Store＋主进程广播时序，保存失败、重试、草稿和小窗。

## 4. 日常计划与图标（主集成）

- [x] `src/ui/app.js`、`project-links.js`、`index.html`：今天与七天安排按区间包含显示；逾期按结束日判断；每日重点3项；详情双日期、快捷安排保持跨度，未改字段草稿随已保存记录同步。
- [x] `src/main.cjs` 接入任务范围变更/撤销；恢复旧备份提示与版本对应。
- [x] 新本地导航图标资源与统一样式，桌面/小窗复用，无网络加载。
- [x] 扩展 `scripts/project-gantt-test.cjs`：多日今天/未来/逾期、单条完成、日程/提醒/重点、图标、320/360/460/宽窗和会话。

## 5. 验证与交付

- [x] 独立复核数据和界面语义，修复可复现问题。运行数据测试、三份项目后台脚本及原记背回归。
- [x] 生成新的隔离预览目录，不覆盖旧预览或正式安装；保留用户可能写入的试用数据。只创建新桌面入口并核验，不启动。
- [x] 从最终包提取页面再次测试，逐文件校验源码/预览注入及原生自测。更新 AGENTS/验收证据，交给用户亲自验收后才提交发布。

执行结果：实现与隔离验收包交付完成。实际用户验收、提交及发布仍待后续授权；后台结果见 docs/ACCEPTANCE.md 的每日网格章节。多日任务 UI 检查独立保留在 scripts/task-range-ui-test.cjs。
