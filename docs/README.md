---
title: "ContectHub 文档中心"
category: index
status: active
version: 1.0
updated_at: "2026-09-03"
---

# ContectHub 文档中心

> 面向企业/平台的 AI-Native 数字内容供应链系统（A-DCSC）：内容"存储、制作、管理、分发"全链路。
> 文档编号体系见 [FND-GOV-001](./00-foundation/governance/FND-GOV-001-numbering-system.md)。

## 📚 文档中心导航

文档按 `[分类]-[领域]-[序号]-名称.md` 编号组织。以下为当前制品层（现行有效）文档：

### 📋 基础治理 `00-foundation/`

| 文档 | 说明 |
|------|------|
| [编号体系](00-foundation/governance/FND-GOV-001-numbering-system.md) | 文档统一编号、frontmatter、校验（起点） |
| [生命周期与归档](00-foundation/governance/FND-GOV-002-document-lifecycle-and-archiving.md) | active/draft/deprecated/archived + 归档机制 |
| [治理模式](00-foundation/governance/FND-GOV-003-doc-governance-model.md) | 全保留·小索引·单一权威 + 分流三问 |
| [标准文档模板](00-foundation/templates/FND-TMP-001-document-template.md) | 新建文档复制的模板 |

### 🚀 战略规划 `strategy/`

| 文档 | 说明 |
|------|------|
| [愿景与项目章程](strategy/STR-BV-001-digital-content-supply-chain-vision.md) | A-DCSC 定义、三态分离、架构、路线（起点） |

---

> 🗄️ 过程层归档在 `docs/archive/`（不入导航与索引，见 GOV-003）。类别词表见 FND-GOV-001 §3/§4。

## 文档规范

- **编号体系**：`[CATEGORY]-[DOMAIN]-[SEQ]-name.md`，详见 [FND-GOV-001](./00-foundation/governance/FND-GOV-001-numbering-system.md)
- **文档模板**：[FND-TMP-001](./00-foundation/templates/FND-TMP-001-document-template.md)
- **命名/元数据校验**：`python3 scripts/docstd --docs ./docs check`
- **重建索引**：`python3 scripts/docstd --docs ./docs index`