---
doc_id: FND-GOV-001
title: "ContentHub 文档治理规范"
category: FND
domain: GOV
status: active
version: 2.0
doc_type: governance
author: "zhoudabo"
created_at: "2026-09-03"
updated_at: "2026-09-04"
tags: [governance, numbering, lifecycle, documentation]
related: [FND-TMP-001]
---

# ContentHub 文档治理规范

## 1. 目的与适用范围

定义 ContentHub（面向企业/平台的 AI-Native 数字内容供应链系统 A-DCSC）`docs/` 目录的编号、元数据与生命周期规则，使每篇文档可识别、可索引、可校验。

适用于 `docs/` 下所有 Markdown 文档；`README.md`、`.ai-context.md` 豁免。

## 2. 编号格式

```
[CATEGORY]-[DOMAIN]-[SEQUENCE]-[name].md
```

| 组成 | 说明 | 格式 | 示例 |
|------|------|------|------|
| CATEGORY | 文档分类 | 3-4 字母大写 | （见 §3） |
| DOMAIN | 业务领域 | 2-4 字母大写 | （见 §3） |
| SEQUENCE | 顺序编号 | 3 位数字 | 001 |
| name | 可读名称 | 小写 kebab-case | overview |

- SEQUENCE 从 001 起；`000` 保留给领域索引/概览
- name 用**小写英文**；中文标题写在 frontmatter `title`
- DOMAIN 按"同一主题的现行权威文档共用一个号段"分配，宁可少建、不可混放；新文档用 `docstd next <CAT-DOM>` 查下一序号，或 `docstd new` 直接创建并更新索引

## 3. 分类与领域词表

| 编码 | 分类 | 目录 | DOMAIN 起步建议 |
|------|------|------|----------------|
| FND | 基础治理 | `00-foundation/` | GOV（治理，即本文档）/ TMP（模板） |
| STR | 战略规划 | `strategy/` | BV（愿景/章程） |
| EA | 架构设计 | `architecture/` | 按架构视角逐步补充 |
| PRD | 产品需求 | `product/` | 按产品模块，业务定型后确定 |
| ENG | 工程技术 | `engineering/` | DEV（开发指南）/ COMP（组件） |
| QA | 质量测试 | `quality/` | TST（测试） |
| OPS | 运维部署 | `deployment/` | DEP（部署）/ MON（监控） |
| KNW | 知识经验 | `knowledge/` | EXP（经验教训册） |

## 4. frontmatter

每篇文档必须以 YAML frontmatter 开头：

```yaml
---
doc_id: <CAT>-<DOM>-001        # 必填，与文件名前缀一致
title: <中文标题>               # 必填
category: <CAT>                # 必填
domain: <DOM>                  # 必填
status: draft                  # 必填：draft|active|deprecated
version: 1.0                   # 必填
author: <作者>                 # 必填
created_at: YYYY-MM-DD         # 必填
updated_at: YYYY-MM-DD         # 必填，随版本更新
tags: [...]                    # 选填
related: [...]                 # 选填，关联 doc_id
---
```

## 5. 生命周期

状态只有三个，**只在本节定义一次**：

| 状态 | 含义 | 可作为权威入口 |
|------|------|---------------|
| `draft` | 草稿/讨论中（含评审） | ❌ 仅供协作 |
| `active` | 当前有效、持续维护 | ✅ 是 |
| `deprecated` | 已过时 | ❌ 文首须写明原因与替代入口（doc_id/路径） |

## 6. 治理三原则

1. **git 即档案馆**：过程性思考、被替代的旧稿直接删除，`git log` / `git show` 可随时找回；仓库内不设归档目录、不设 `archived` 状态。
2. **小索引**：导航（`docs/README.md`、`docs/.ai-context.md`）与校验只覆盖现行文档；`draft` 不作为权威入口，`deprecated` 退出导航。
3. **单一权威（SPOT）**：同一事实只有一个权威出处，其余引用链接、禁止复制。冲突裁决：代码 > active 文档。

**写新文档前先过三问**：① 写的是当前事实还是过程思考？过程思考写完即删（git 留痕）。② 是否已有权威文档可挂靠？有则链接或补充小节，不新建。③ 结论是否可蒸馏进 `docs/knowledge/KNW-EXP-*` 经验册？

## 7. 校验与索引

```bash
python3 scripts/docstd --docs ./docs check    # 命名 + frontmatter + doc_id 一致性（pre-commit 自动执行）
python3 scripts/docstd --docs ./docs index    # 重建 docs/00-foundation/id-mapping.json
```

命名正则：`^(FND|STR|EA|PRD|ENG|QA|OPS|KNW)(?:-[A-Z]{2,4}){1,}-\d{3}-[a-z0-9][-a-z0-9]*\.md$`

**任务完成声明规范**：文档中的"已完成"标记必须绑定代码证据（`✅ 已完成 | commit: <7位短hash> · 日期`），禁止只写日期；commit message 引用 doc_id 便于 `git log --grep` 反查。

## 版本记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-09-03 | 随仓库初始化引入（源自早期项目治理框架） | zhoudabo |
| 1.1 | 2026-09-04 | 项目名更正 ContectHub → ContentHub | zhoudabo |
| 2.0 | 2026-09-04 | 激进裁剪：合并原 GOV-002/003 为本文档，删除归档目录与 archived 状态，状态机收敛为 draft/active/deprecated，对齐单人维护现状 | zhoudabo |
