---
title: "ContentHub 文档中心"
category: index
status: active
version: 1.2
updated_at: "2026-09-04"
---

# ContentHub 文档中心

> 面向企业/平台的 AI-Native 数字内容供应链系统（A-DCSC）：内容"存储、制作、管理、分发"全链路。
> 文档治理规范见 [FND-GOV-001](./00-foundation/governance/FND-GOV-001-numbering-system.md)。

## 📚 文档中心导航

文档按 `[分类]-[领域]-[序号]-名称.md` 编号组织。以下为现行有效文档：

### 📋 基础治理 `00-foundation/`

| 文档 | 说明 |
|------|------|
| [文档治理规范](00-foundation/governance/FND-GOV-001-numbering-system.md) | 编号、frontmatter、生命周期、治理原则（起点） |
| [标准文档模板](00-foundation/templates/FND-TMP-001-document-template.md) | 新建文档复制的模板 |

### 🚀 战略规划 `strategy/`

| 文档 | 说明 |
|------|------|
| [愿景与项目章程](strategy/STR-BV-001-digital-content-supply-chain-vision.md) | A-DCSC 定义、三态分离、产品定位（§8）、路线（起点） |

### 📦 产品需求 `product/`

| 文档 | 说明 |
|------|------|
| [MVP建设方案](product/PRD-MVP-001-mvp-build-plan.md) | v2.0 定位定稿重写：配方派生引擎优先，Web 自托管（M0-M2） |

### 🧠 知识经验 `knowledge/`

| 文档 | 说明 |
|------|------|
| [内容生产自动化经验册](knowledge/KNW-EXP-001-content-supply-chain-lessons.md) | VidFlow 等项目蒸馏的自动化边界教训（字幕/发布/封面/形态） |

---

## 文档规范

- **编号体系**：`[CATEGORY]-[DOMAIN]-[SEQ]-name.md`，详见 [FND-GOV-001](./00-foundation/governance/FND-GOV-001-numbering-system.md)
- **文档模板**：[FND-TMP-001](./00-foundation/templates/FND-TMP-001-document-template.md)
- **命名/元数据校验**：`python3 scripts/docstd --docs ./docs check`
- **重建索引**：`python3 scripts/docstd --docs ./docs index`
- 过程性/被替代的文档直接删除，git 历史即档案馆（见 FND-GOV-001 §6）
