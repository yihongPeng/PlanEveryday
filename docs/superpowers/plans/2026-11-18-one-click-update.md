# 一键更新 Implementation Plan

**Goal:** 安装与更新均使用 D 盘，旧版数据自动保留，失败时不产生空库。
**Architecture:** electron-builder NSIS 安装程序和 electron-updater；程序安装 D:/Programs/PlanEveryday，数据 D:/PlanEverydayData，缓存与临时文件在数据目录。升级前完整数据备份，事务迁移先校验再提交；应用内显式下载和重启安装，不自动退出。
**Tech Stack:** Electron 45、SQLite、electron-builder 26、electron-updater 6。

- [x] 构建 NSIS 安装包，定制 D 盘安装与解压目录，稳定入口，保留卸载数据；安装失败须在删除旧程序前检查可写性/空间。
- [x] 写升级保护测试：旧库保留任务/记背/标签/图片、未知格式/迁移失败不写原库、备份失败阻止安装。
- [x] 实现独立更新控制器：检查/下载/进度/重试/安装状态，sha512 校验由 updater 执行；D 盘缓存，禁止退出自动安装。
- [x] 设置页加入版本、更新按钮、进度与失败反馈；重启前保存运行中草稿到 D 盘并恢复，不能静默丢草稿。
- [x] 本地 HTTP 更新源隔离测试真实 updater：404、断连、哈希错误、正确安装包；打包回归任务/记背/图片。
- [x] 旧 0.4.1 隔离库升级与 NSIS 初装/安装版升级实测，发布版 UI 检查；记录不可验证边界。
- [x] 备份日常数据，切换桌面至安装版并核对数据、自启；更新 README/验收/GitHub release（exe/latest.yml/blockmap）。

用户已批准上述设计并要求直接执行，不再重复请求设计确认。旧便携目录不擅自删除；安装版接管快捷方式。Windows 系统自身日志/安装器启动前 OS 临时行为不作零写入承诺，应用主动写入数据、下载、解压统一 D 盘。
