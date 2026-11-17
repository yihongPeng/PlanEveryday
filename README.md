# 芽芽计划 · PlanEveryday

一个本地运行的 Windows 个人计划助手。桌面上的小芽团子是入口，点击打开计划，拖动可移动，右键可隐藏或退出。

## 开始体验

- 双击桌面 **芽芽计划** 快捷方式。
- 或运行 `D:\PlanEveryday\release\0.3.0\PlanEveryday-win32-x64\PlanEveryday.exe`。
- 首次启动会显示计划小窗和桌宠；右上角 □ 可以最大化，再点击可还原。
- 关闭窗口只会收起，桌宠和提醒继续运行。完全退出可用托盘右键或设置页的退出按钮。
- 快捷方式指向发布目录，请保留整个 `release\0.3.0\PlanEveryday-win32-x64` 文件夹，不能只移动其中的 exe。
- 0.2.2 使用原生桌宠。收起约 10 秒后释放计划窗口的渲染进程，再打开恢复本次运行的草稿、筛选与阅读位置；提醒始终在后台调度。

## 怎么做计划

1. 在“今天”输入一件事，回车保存；连续输入可快速记录多件事。
2. 暂时不知道哪天做的事，先放“收集箱”。
3. 点击任务右侧日期，可安排到今天、明天或指定日期。
4. 点击 ☆，选出最多 3 件今日重点；点圆圈标记完成。
5. 在“安排”选择未来 7 天中的一天，从收集箱逐项安排，也可以多选批量调整日期。
6. 点击任务标题，编辑备注、优先级或提醒；修改后点击保存。
7. Ctrl+N 聚焦新增，Ctrl+F 搜索。中文输入法选词不会提交任务。

## 记背

点击底部或侧栏“记背”，新建标题和正文。点击标题直接进入阅读页，按段落保留换行；需要修改时再点“编辑”。支持全文搜索、置顶和删除确认。返回列表保留搜索词；未保存草稿在本次运行中保留，包括窗口收起释放再打开。

记背内容与任务一起进入 v2 备份。恢复旧版 v1 备份会清空记背，应用会先提示并自动备份当前数据。

计划日期与提醒时间相互独立：调整计划日期不会自动改提醒。完全退出后不能发通知，再次启动会汇总错过的提醒。系统通知是否展示也受 Windows 通知权限/专注模式影响，应用内有提醒记录作为补充。

## 数据与备份

发布版数据在 `D:/PlanEverydayData/planner.sqlite`，以设置页“打开数据目录”实际打开的目录为准。不会上传任务，不需要注册。备份导出和恢复位于设置页；恢复前会提示替换，并在数据目录下自动保存一份旧数据 JSON。

测试使用独立临时数据目录，不会写入体验版的真实任务。

## 开发与验证

需要 Node.js 24 或兼容当前依赖的版本。

```powershell
npm ci
npm start
npm test
npm run test:desktop
npm run package
powershell -ExecutionPolicy Bypass -File scripts/install-shortcut.ps1
```

测试发布版本：

```powershell
$env:PLANEVERYDAY_EXE = 'D:\PlanEveryday\release\0.3.0\PlanEveryday-win32-x64\PlanEveryday.exe'
$env:PLANEVERYDAY_TEST_NO_FOCUS = '1'
node scripts/desktop-test.cjs
node scripts/native-checks.cjs
node scripts/experience-test.cjs
node scripts/notification-test.cjs
```

验收状态见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。0.2.2 已完成内存优化与记背功能，尚未把多屏、真实系统休眠和用户主观评价标记为通过。原生桌宠使用 Windows 自带 .NET Framework，构建时运行 `node scripts/build-pet.cjs`（打包脚本自动执行）。首次正常启动发布版会更新桌面和开始菜单快捷方式及通知应用标识。

图形和桌宠由本项目代码绘制，不依赖外部美术素材；运行时依赖及其许可证随 Electron 发布目录保留。

0.2.2 正式数据、备份与缓存统一保存在 `D:/PlanEverydayData`。D 盘不可用时停止，不回退 C 盘。旧 C 盘数据已移到 D 盘 legacy-archive-20261117；请勿再使用旧版程序。记背支持 Markdown 标题、列表、强调、引用、代码块、表格与网页链接，编辑保留原文。外部图片显示说明文字而不联网。渲染器使用离线打包的 [markdown-it](https://github.com/markdown-it/markdown-it)。

0.3.0：记背增加多个标签（最多 12 个，每个 24 字）、已有标签复用、未分类、标签筛选与搜索交集。输入用逗号分隔；点击标签即可复习同主题笔记。采用米白与苔绿的紧凑阅读排版，列表含摘要，支持 Markdown。旧内容保留，新备份格式 v3 仍支持导入 v1/v2。
