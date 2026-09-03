---
doc_id: FND-GOV-002
title: 文档生命周期与归档机制
category: FND
domain: GOV
status: active
version: 1.0
doc_type: governance
author: zhoudabo
created_at: 2026-06-28
updated_at: 2026-06-28
tags: [governance, documentation, lifecycle, archiving]
related: [FND-GOV-001]
---

# 文档生命周期与归档机制

## 1. 目的与范围

定义 ContectHub 项目 `docs/` 目录下文档的生命周期管理规则，解决：

- 文档与实现/事实脱节时，谁为准。
- 文档不再适用时如何**废弃但仍可追溯**。
- 文档的替代关系如何表达、可检索。

适用范围：`docs/` 下所有编号文档（FND/STR/EA/PRD/ENG/QA/OPS/KNW 各分类）。外部引用/材料类文档可按 §6「例外」执行。

## 2. 生命周期状态

状态用 frontmatter `status` 表达：

| 状态 | 含义 | 是否可作为权威入口 |
|------|------|-------------------|
| `active` | 当前有效、持续维护 | ✅ 是 |
| `draft` | 草稿/方案讨论中 | ❌（仅供协作） |
| `deprecated` | 已过时（有替代或实现已变）| ❌（须给出替代指引） |
| `archived` | 归档，仅历史追溯 | ❌ |

> `deprecated` 仍可能短期被参考但必须标明替代入口；`archived` 仅作历史备查，退出导航与索引。

## 3. 归档目录与命名

### 3.1 文档内归档（`docs/archive/`）

对**过时/过程中产出的文档**，统一移入 `docs/archive/`，并在原文首（或归档副本顶部）标明：

- 归档原因、停止维护时间点
- 替代入口（如有）

`docs/archive/` 为**门禁豁免目录**（docstd 命名校验天然跳过 `archive/`），可保留——不需要编号。

### 3.2 归档原则（全保留）

- **归档即保留，永不删除**；误归档可随时恢复。
- 归档文档**不进导航、不进索引、不进门禁**（见 GOV-003「小索引」）。
- git 历史是零维护成本的另一层档案馆（`git log --grep` 反查）。

## 4. deprecated 必备信息

当某文档被标记为 `deprecated` 时，文首必须说明：

- 过时原因（实现变更 / 架构调整 / 被替代）
- 替代入口（新文档 doc_id 或路径）
- 迁移建议（如读者仍可能按旧流程操作）

## 5. 任务完成声明规范（防虚假完成）

受影响文档中的"已完成"标记，**必须绑定代码证据**，禁止只写日期：

```
✅ 已完成 | commit: <7位短hash> · 日期
```

要点：
1. 仅有日期/文字描述不合规；
2. commit message 尽量引用 doc_id（如 `docs(contecthub): ... 收尾 (PRD-XXX-001)`），便于 `git log --grep` 反查；
3. 若本文档指工程制品，证据以 `git log`/代码为准，而非仅口头声明。

## 6. 例外（资料库/材料类）

`docs/archive/`、参考素材、非工程材料可不强制追求编号与完整 frontmatter，但推荐保留最少可检索信息。

## 7. 索引同步

当发生以下变更时，必须重建索引以保持一致：

```bash
python3 scripts/docstd --docs ./docs index
```

- 新增/删除/重命名编号文档
- 文档 active → deprecated/archived
- 移动分类/目录

同时保持 `docs/README.md` 入口无死链。

## 变更记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-06-28 | 初始版本 | zhoudabo |