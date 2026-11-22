# 记背正文目录实施计划

本次在当前工作区顺序实施；用户验收前不提交或发布。

**目标：** 每篇记背可选择生成可点击、可折叠的正文标题目录，原文不变。

**结构：** Markdown 模块负责标题与锚点；Store 负责可选布尔字段；记背视图负责目录、滚动和草稿。沿用当前 Electron、markdown-it、Node SQLite，不加依赖。

- [x] 在 `tests/markdown.test.cjs` 补真实标题、重复/恶意标题和代码块排除测试；先运行见失败，再实现 `src/ui/markdown.js` 同流解析。
- [x] 在 `tests/store.test.cjs` 补开关持久化、旧字段缺省、坏值及失败保存/恢复；先运行见失败，再改 `src/store.cjs`，不迁移正式库。
- [x] 在 `src/ui/memory.js` 加编辑开关、目录渲染、内部滚动和折叠会话；在 `src/ui/memory.css` 控制长目录、窄屏、焦点和标题滚动间距。使用 frontend-design 复查。
- [x] 新增 `scripts/memory-toc-test.cjs` 用独立 D 盘数据回归真实 Electron 布局/保存/隐藏恢复；最终预览包在 `release/previews/memory-toc-20261122-review`，不复用 `release/0.5.2`。
- [x] 直接运行 `node --test tests/*.test.cjs`（53 项通过）及打包目录专项测试，记录到 `docs/ACCEPTANCE.md`；截图检查并修正 CSP 下的缩进与展开箭头。
- [x] 准备独立验收入口和三篇示例笔记。
- [x] 用户验收：2026-11-22 回复“同意改动”，授权进入正式交付。
- [ ] Git 提交、推送、0.5.3 发布和正式桌面替换；发布验收结果见 docs/ACCEPTANCE.md。

自查：范围仅正文目录；旧记录无字段默认关闭；保存与备份支持保留字段；目录文本和正文同源；方案未包含不明根因的快捷方式修复，也不修改历史安装包。
