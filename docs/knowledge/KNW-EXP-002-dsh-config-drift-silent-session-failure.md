---
doc_id: KNW-EXP-002
title: 工具链配置漂移与静默失败教训册（DSH）
category: KNW
domain: EXP
status: active
version: 1.0
doc_type: knowledge
author: zhoudabo
created_at: 2026-09-23
updated_at: 2026-09-23
tags: [经验教训, 配置漂移, 静默失败, DSH, 工具链]
related: [FND-GOV-001]
---

# 工具链配置漂移与静默失败教训册（DSH）

> 来源：2026-09-23 DSH Web GUI「新建工作区后无法创建新会话」事故复盘。三条教训不限于 DSH：凡"本机配置随工具版本演进漂移"或"失败只落在静默通道"的故障，均适用。

## L-001 工具版本升级后，指向旧版标识的默认配置会漂移成无效值

| 项 | 内容 |
|----|------|
| 日期 | 2026-09-23 |
| 现象 | 在 DSH Web GUI 新建工作区后，点「新建会话」无任何反应；每次尝试均失败，界面不报错 |
| 根因 | `~/.dsh/settings.yaml` 中 `agent-presets.default: code` 指向的 preset 在该版本已不存在。当前安装的 `@deepseek-ai/dsh-agent-presets@0.1.5-rc.2` 实际只随包提供 `standard / ptc / minimal / cordis` 四个 preset（`presets/` 目录核实），会话创建解析默认 preset 时抛 `agent-preset/not-found: preset "code" not found` |
| 解决方案 | 将 `agent-presets.default` 改为实际存在的 `standard`（功能完整的编码 Agent，order 1）；改动前先备份 `settings.yaml`。DSH 的 `dsh-settings-file` 监听设置文件并热重载，**无需重启**即生效 |
| 预防措施 | ①升级工具后，把「带枚举标识的配置项」（preset/model/id 白名单）纳入升级后自检；②配置里不要写凭记忆的短名，写之前用命令核实实际可用值（如 `ls <pkg>/presets/`）；③错误信息里的 `available: …` 就是权威词表，照它选 |

## L-002 客户端只 `console.warn` 的失败路径，会把明确错误伪装成「没反应」

| 项 | 内容 |
|----|------|
| 日期 | 2026-09-23 |
| 现象 | 界面层面症状是「按钮点了没反应」，无 toast / 无错误弹窗，容易误判为 UI 或工作区问题 |
| 根因 | DSH 前端 `dsh-client-ui-workspace` 的新建会话路径对失败只做 `console.warn("new session failed:", reason)`（源码核实），不向用户呈现；且空白新会话在首条提示词落地前只是「临时占位行」，失败后即消失，进一步掩盖了失败 |
| 解决方案 | 打开浏览器开发者工具 Console，复现操作，从 `new session failed:` 后的 `SessionCreateError` 读到精确根因（`agent-preset/not-found`） |
| 预防措施 | 排查「点了没反应」类问题，**第一步永远是看 Console / 日志的静默通道**，而不是先怀疑界面或业务对象；把「关键动作失败必须可见」当作选型/自研的验收项，静默 warn 等于没报错 |

## L-003 先用文件系统与源码取证，再下结论（避免凭直觉归因到现场对象）

| 项 | 内容 |
|----|------|
| 日期 | 2026-09-23 |
| 现象 | 由于失败恰好发生在「新建工作区之后」，最初极易归因为「这个工作区路径有问题」（父目录 / 含 Syncthing 标记等） |
| 根因 | 该归因是相关性联想而非因果：错误实际来自全局 preset 解析，**在任何工作区都会失败**。当时已可从 `~/.dsh/storages/workspace.json`（`sessionIds: []`）与缺失的 `~/.dsh/sessions/<workspace>` 目录判定会话从未创建成功 |
| 解决方案 | 按序取证：读注册表与状态文件确认「从未成功创建」→ 读源码定位失败通道与可选值 → 拿到 `available:` 词表 → 最小改动修复 → 备份 |
| 预防措施 | 遵循 FND-GOV-001 / CLAUDE.md「先验证再行动、区分事实与推断」：把「失败发生在我刚操作的对象上」与「失败由该对象引起」严格分开；每条判断标注 `✅ 已验证：[命令+输出]` 或 `⚠️ 推断：…`，直到拿到决定性证据再动手 |

## 相关文档

- [FND-GOV-001 文档治理规范](../00-foundation/governance/FND-GOV-001-numbering-system.md)
- [KNW-EXP-001 内容生产自动化经验册](KNW-EXP-001-content-supply-chain-lessons.md)

## 变更记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-09-23 | 首次沉淀：DSH 新建会话静默失败事故，三条教训（L-001 配置漂移 / L-002 静默失败 / L-003 取证纪律） | zhoudabo |
