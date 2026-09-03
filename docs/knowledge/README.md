# 知识经验教训册

本目录收录 ContentHub 开发过程中沉淀的经验/坑（KNW-EXP-*）。

## 何时沉淀

发生返工 / 反复踩坑 / 生产或工程异常等事故后，收尾前把根因与预防沉淀进一条经验；动手前先查阅本目录避免重蹈覆辙（见 FND-GOV-001 §6「三问」第 3 条）。

## 命名与格式

- 编号：`KNW-EXP-001-<英文slug>.md`（用 `python3 scripts/docstd --docs ./docs new KNW EXP <slug> --title "..."` 分配）
- 每条经验用 `L-NNN <主题>` + 表格：日期 / 现象 / 根因 / 解决方案 / 预防措施
- 结论蒸馏入本目录后，过程性原文直接删除（git 历史即档案馆，见 FND-GOV-001 §6）

## 索引

- [KNW-EXP-001 内容生产自动化经验册](KNW-EXP-001-content-supply-chain-lessons.md) — VidFlow 等项目蒸馏：字幕断句、LLM 创意决策、发布资质壁垒、封面排版、交付形态六条教训
