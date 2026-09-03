# ContectHub 项目约定

**沟通语言：中文。**

## 项目一句话

面向企业/平台的 **AI-Native 数字内容供应链系统（A-DCSC）**：内容 存储→制作→管理→分发 全链路。全貌见 [STR-BV-001 愿景与章程](docs/strategy/STR-BV-001-digital-content-supply-chain-vision.md)。

## 文档规范（重要）

详细文档在 `docs/`，采用统一编号体系 `[分类]-[领域]-[序号]-名称.md`。核心治理文档为起点：

- [FND-GOV-001 编号体系](docs/00-foundation/governance/FND-GOV-001-numbering-system.md) — 文件名/frontmatter/序号规则
- [FND-GOV-002 生命周期与归档](docs/00-foundation/governance/FND-GOV-002-document-lifecycle-and-archiving.md) — active/draft/deprecated/archived + 归档
- [FND-GOV-003 治理模式](docs/00-foundation/governance/FND-GOV-003-doc-governance-model.md) — 全保留·小索引·单一权威 + 分流三问
- [FND-TMP-001 文档模板](docs/00-foundation/templates/FND-TMP-001-document-template.md)

**分类（CATEGORY）**：FND(基础治理), STR(战略规划), EA(架构设计), PRD(产品需求), ENG(工程技术), QA(质量测试), OPS(运维部署), KNW(知识经验)。

- 每篇 `.md` 必须有 frontmatter：`doc_id / title / category / domain / status / version / author / created_at / updated_at / tags`（title 用中文，文件名英文 slug）。
- 编号映射：`docs/00-foundation/id-mapping.json`。
- 导航入口：`docs/README.md`、`docs/.ai-context.md`。
- 校验：`python3 scripts/docstd --docs ./docs check`；重建索引：`python3 scripts/docstd --docs ./docs index`。

## 开发 / 写文档前置检查清单

- [ ] **分流三问**（FND-GOV-003）：写的是当前事实还是过程思考？已有权威文档就引用链接而非新建？结论能否入 KNW 经验册？
- [ ] **写新文档先分配编号**：`python3 scripts/docstd --docs ./docs new <CAT> <DOM> <slug> --title "中文标题"`，或查 `id-mapping.json` / `docstd next`。
- [ ] **先查后写**：搜索是否已有可复用实现 / 权威文档，避免重复。
- [ ] **文档加完整 frontmatter**，正文结尾更新「变更记录」表与 frontmatter `version`。
- [ ] **开发前读经验教训册**：`docs/knowledge/KNW-EXP-*`（若有）。

## 根目录卫生 & 归档

- 根目录只放项目级文件；过程性/过时文档进 `docs/archive/`（不入导航与索引）。
- 任务"已完成"声明须绑定 `commit: <hash>` 证据（见 GOV-002），禁止仅写日期。

## 提交与推送（无 CI/CD 门禁）

- 本仓库**不上传任何 GitHub Actions / CI/CD 门禁**，推送不会因文档/CI 被阻断，也不消耗云端算力。
- 已装**本地** pre-commit hook：仅在你 `git commit` 时对 `docs/*.md` 做命名/元数据检查（本地零成本，可随意改、不会推送到远端）。
- 若本地 hook 偶觉多余，可随时 `git config --unset core.hooksPath` 关闭。
