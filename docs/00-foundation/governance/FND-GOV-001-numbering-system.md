---
doc_id: FND-GOV-001
title: "ContectHub 文档统一编号体系"
category: FND
domain: GOV
status: active
version: 1.0
doc_type: governance
author: "zhoudabo"
created_at: "2026-06-28"
updated_at: "2026-06-28"
tags: [governance, numbering, standard]
related: [FND-TMP-001, FND-GOV-002, FND-GOV-003]
---

# ContectHub 文档统一编号体系

## 1. 概述

### 1.1 目的
定义 ContectHub（面向企业/平台的 AI-Native 数字内容供应链系统(A-DCSC):内容存储/制作/管理/分发全链路）项目文档的统一编号体系，使每篇文档从文件名即可判断分类与领域，并支持自动化索引与校验。

### 1.2 适用范围
适用于 `docs/` 目录下所有 Markdown 文档。新文档必须使用本体系。

### 1.3 核心原则
1. **可排序**：编号按 分类→领域→序号 自然排序
2. **可识别**：从文件名即可判断分类与领域
3. **可追踪**：编号与文档一一对应，全局唯一
4. **可扩展**：新增分类或领域无需重新编号

## 2. 编号格式

```
[CATEGORY]-[DOMAIN]-[SEQUENCE]-[name].md
```

| 组成 | 说明 | 格式 | 示例 |
|------|------|------|------|
| CATEGORY | 文档分类 | 3-4 字母大写 | （见第 3 节） |
| DOMAIN | 业务领域 | 2-4 字母大写 | （见第 4 节） |
| SEQUENCE | 顺序编号 | 3 位数字 | 001 |
| name | 可读名称 | 小写 kebab-case | overview |

- SEQUENCE 从 001 起；`000` 保留给领域索引/概览
- name 用**小写英文**；**中文标题**写在 frontmatter `title` 字段

## 3. 分类编码（CATEGORY）

> 本项目词表，根据 ContectHub 业务定制。

| 编码 | 分类 | 目录 |
|------|------|------|
| FND | 基础治理 | `00-foundation/` |
| STR | 战略规划 | `strategy/` |
| EA | 架构设计 | `architecture/` |
| PRD | 产品需求 | `product/` |
| ENG | 工程技术 | `engineering/` |
| QA | 质量测试 | `quality/` |
| OPS | 运维部署 | `deployment/` |
| KNW | 知识经验 | `knowledge/` |

## 4. 领域编码（DOMAIN）

本项目 DOMAIN 词表随业务演进，以下为**起步建议**（可嵌套，如 `PRD-ASST-001` 用 4 段表达"产品-资产"）。按"文档本质"选择，宁可少建、不可混放。

> 设计要领：DOMAIN 决定"同一分类下一批文档该不该放一起"。参考 GOV-003「分流三问」：**同一模块/主题的现行权威文档配一个 DOMAIN 号段**；无关主题不要共用 DOMAIN 以免序号语义混乱。

| 分类 | DOMAIN 起步建议 | 说明 |
|------|----------------|------|
| FND | GOV（治理）/ TMP（模板）| FND 内固定：编号/生命周期/治理用 GOV；模板用 TMP |
| STR | BV（愿景）| 项目章程、商业定位、愿景（如 STR-BV-001）|
| EA | 按架构视角（如 AAA 应用架构、DATA 数据架构、TECH 技术架构、SEC 安全架构）| 逐步补充，每视角配 DOMAIN |
| PRD | 按产品模块（如 ASST 素材管理/资产、POST 半成品、FINAL 制成品、BLOOD 血缘、REN 渲染引擎、SEARCH 检索…）| 模块名待业务定型后确定，宁缺毋滥 |
| ENG | DEV（开发指南）/ COMP（组件）| 工程规范、实现说明 |
| QA | TST（测试）| 测试计划/报告 |
| OPS | DEP（部署）/ MON（监控）| 运维部署、监控排障 |
| KNW | EXP（经验）| 经验教训册（KNW-EXP-*）|


## 5. 序号分配规则

1. 每个分类-领域组合独立序号空间，从 001 递增
2. 已删除文档序号不回收
3. `000`=领域索引，`001-899`=常规，`900-999`=草稿

## 6. 文档头部信息（frontmatter）

每篇文档必须以 YAML frontmatter 开头：

```yaml
---
doc_id: <CAT>-<DOM>-001        # 必填，与文件名一致
title: <中文标题>               # 必填
category: <CAT>                # 必填
domain: <DOM>                  # 必填
status: active                 # 必填：draft|review|active|deprecated
version: 1.0                   # 必填
author: <作者>                 # 必填
created_at: YYYY-MM-DD         # 必填
updated_at: YYYY-MM-DD         # 必填
tags: [...]                    # 选填
related: [...]                 # 选填，关联 doc_id
---
```

## 7. 合规检查

命名正则：
```regex
^(FND|STR|EA|PRD|ENG|QA|OPS|KNW)(?:-[A-Z]{2,4}){1,}-\d{3}-[a-z0-9][-a-z0-9]*\.md$
```
CATEGORY 白名单：`FND|STR|EA|PRD|ENG|QA|OPS|KNW`

校验脚本：`scripts/doc-check-naming.sh`（或 `docstd check`）。豁免：`README.md`、`archive/`、`.ai-context.md`、`id-mapping.json`。

## 8. 编号管理流程

1. 确定 CATEGORY 与 DOMAIN
2. 查 `00-foundation/id-mapping.json` 该领域最大序号（或 `docstd next <CAT-DOM>`）
3. 分配下一序号，更新 `id-mapping.json`（或 `docstd new`）
4. 在 frontmatter 填 `doc_id`

## 版本记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-06-28 | 初始版本 | zhoudabo |
