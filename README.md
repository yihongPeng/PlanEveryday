# 芽芽计划 · PlanEveryday

一个本地运行的 Windows 个人计划助手。桌面上的小芽团子是入口，点击打开计划，拖动可移动，右键可隐藏或退出。

**下载使用：[最新 Windows 安装版](https://github.com/yihongPeng/PlanEveryday/releases/latest)** · [源码仓库](https://github.com/yihongPeng/PlanEveryday)

下载并运行 `PlanEveryday-Setup-0.5.0.exe`，安装程序会创建桌面入口。当前版本需要 Windows 10/11 x64 和可写的 **D 盘**，数据与缓存固定在 `D:\PlanEverydayData`；无需登录。代码采用 [MIT 许可证](LICENSE)，欢迎下载使用和改进。

设置 → 启动方式 → **开机自启**：默认关闭；开启后登录 Windows 时只显示桌宠与托盘，不弹计划窗口。设置读取系统实际状态，不随数据备份导入。系统启动项和快捷方式属于 Windows 配置，任务、记背和备份仍在 D 盘。

## 开始体验

- 双击桌面 **芽芽计划** 快捷方式。
- 或运行 `D:\Programs\PlanEveryday\PlanEveryday.exe`。
- 首次启动会显示计划小窗和桌宠；右上角 □ 可以最大化，再点击可还原。
- 关闭窗口只会收起，桌宠和提醒继续运行。完全退出可用托盘右键或设置页的退出按钮。
- 安装版入口固定在 D:/Programs/PlanEveryday，更新会自动接管；不要单独移动 exe。
- 0.2.2 使用原生桌宠。收起约 10 秒后释放计划窗口的渲染进程，再打开恢复本次运行的草稿、筛选与阅读位置；提醒始终在后台调度。

## 更新与旧数据

0.4.1 及更早的便携版需要最后手动运行一次安装包；无需搬运数据库或图片，现有 D:/PlanEverydayData 会直接保留。安装前请保存旧版编辑并从设置或托盘正常退出。安装版在设置 → 软件更新中检查、下载、重启更新，不在普通退出时自动安装。下载失败可重试，下载与解压缓存在 D 盘。

升级前自动备份任务、记背和引用图片。数据格式无法识别或迁移失败时停止启动，不用空库替代。应用内更新会保存当前编辑草稿并在重新打开后恢复。卸载默认不删除个人数据。历史便携目录不会擅自删除，更新后请使用新的桌面入口。

当前安装包没有商业代码签名证书；更新使用公开 GitHub Release 的 HTTPS 下载与 SHA-512 校验。Windows 系统管理的快捷方式、注册表和系统日志不属于应用数据目录。具体失败场景验收与边界见 [验收记录](docs/ACCEPTANCE.md)。

## 怎么做计划

1. 在“今天”输入一件事，回车保存；连续输入可快速记录多件事。
2. 暂时不知道哪天做的事，先放“收集箱”。
3. 点击任务右侧日期，可安排到今天、明天或指定日期。
4. 点击 ☆，选出最多 3 件今日重点；点圆圈标记完成。
5. 在“安排”选择未来 7 天中的一天，从收集箱逐项安排，也可以多选批量调整日期。
6. 点击任务标题，编辑备注、优先级或提醒；修改后点击保存。
7. 点击桌宠、系统提醒或提醒入口会清除当前未读小点，记录仍保留；新提醒会重新点亮。
8. Ctrl+N 聚焦新增，Ctrl+F 搜索。中文输入法选词不会提交任务。

## 记背

点击底部或侧栏“记背”，新建标题和正文。点击标题直接进入阅读页，按段落保留换行；需要修改时再点“编辑”。支持全文搜索、置顶和删除确认。返回列表保留搜索词；未保存草稿在本次运行中保留，包括窗口收起释放再打开。

记背内容、标签和图片与任务一起进入 v4 备份（单个 JSON 文件）。恢复旧版 v1 备份会清空记背，应用会先提示并自动备份当前数据。

计划日期与提醒时间相互独立：调整计划日期不会自动改提醒。完全退出后不能发通知，再次启动会汇总错过的提醒。系统通知是否展示也受 Windows 通知权限/专注模式影响，应用内有提醒记录作为补充。

编辑正文时点击 **插入图片**、直接 **Ctrl+V 粘贴截图**，或将图片文件拖入正文。图片保存在 `D:/PlanEverydayData/images`，无需联网；单张最多 10 MB、2500 万像素，导入后统一保存为静态 PNG（动图取首帧）。正文插入 `![图片](plan-image://local/…)` 后需保存笔记。阅读时图片随窗口缩放，附件随备份一起导出和恢复；图片总量最多 100 MB，完整备份最多 150 MB。删除笔记暂不清理图片文件，避免误删草稿或历史内容。

代码块注明语言（如 `python`、`cpp`、`js`、`json`、`sql`）即可获得离线语法高亮；未知语言保留纯文本。使用本地 [highlight.js](https://github.com/highlightjs/highlight.js/) 常用语言包，不加载网络脚本。

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
$env:PLANEVERYDAY_EXE = 'D:\PlanEveryday\release\0.4.1\PlanEveryday-win32-x64\PlanEveryday.exe'
$env:PLANEVERYDAY_TEST_NO_FOCUS = '1'
node scripts/desktop-test.cjs
node scripts/native-checks.cjs
node scripts/experience-test.cjs
node scripts/notification-test.cjs
node scripts/media-test.cjs
```

验收状态见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。0.2.2 已完成内存优化与记背功能，尚未把多屏、真实系统休眠和用户主观评价标记为通过。原生桌宠使用 Windows 自带 .NET Framework，构建时运行 `node scripts/build-pet.cjs`（打包脚本自动执行）。首次正常启动发布版会更新桌面和开始菜单快捷方式及通知应用标识。

图形和桌宠由本项目代码绘制，不依赖外部美术素材；运行时依赖及其许可证随 Electron 发布目录保留。

0.2.2 正式数据、备份与缓存统一保存在 `D:/PlanEverydayData`。D 盘不可用时停止，不回退 C 盘。旧 C 盘数据已移到 D 盘 legacy-archive-20261117；请勿再使用旧版程序。记背支持 Markdown 标题、列表、强调、引用、代码块、表格与网页链接，编辑保留原文。外部图片显示说明文字而不联网。渲染器使用离线打包的 [markdown-it](https://github.com/markdown-it/markdown-it)。

0.3.0：记背增加多个标签（最多 12 个，每个 24 字）、已有标签复用、未分类、标签筛选与搜索交集。输入用逗号分隔；点击标签即可复习同主题笔记。采用米白与苔绿的紧凑阅读排版，列表含摘要，支持 Markdown。旧内容保留，新备份格式 v3 仍支持导入 v1/v2。

0.4.1：采用“安静的温暖”默认界面，移除持续标语、鼓励横幅和桌宠气泡，保留配色、阅读排版及必要提示。记背阅读页直接呈现标题与正文。
