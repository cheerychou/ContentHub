---
doc_id: EA-ARC-002
title: 效率工具 UI 重设计——工作台 / 派生流水线 / 资产档案
category: EA
domain: ARC
status: draft
version: 1.0
author: zhoudabo
created_at: 2026-10-28
updated_at: 2026-10-28
tags: [信息架构, 效率工具, 工作台, 派生流水线, Run 卡片板, 血缘网络, UI 先行]
related: [STR-BV-001, PRD-MVP-001, EA-ARC-001, KNW-EXP-001]
---

# 效率工具 UI 重设计：工作台 / 派生流水线 / 资产档案

> **目的**：把 UI 从"管理信息系统"逻辑（先选柜子→找记录→找按钮）重构为"效率工具"逻辑（打开即知该干什么、一键批量干活），不改动后端已验收的资产模型与状态机。
> **决策过程**：2026-10-28 与用户逐项拍板——产品主重心（工作台+派生流水线双支柱）、建设顺序（UI 先行、编排内核并行）、信息架构（三区骨架）、工作台布局（双栏关注流）、流水线形态（Run 卡片板）、档案页组织（单表全量）、体用定性。
> **配套阅读**：编排内核参照 [EA-ARC-001](EA-ARC-001-dify-workflow-study-notes.md)；本文 §3 的 run 模型是其五表方案的最简先导版。

## 1. 定位：以资产血缘为体，以生产效率为用

**一句话定位**：ContentHub 以内容资产与血缘体系为体（事实源、护城河、已建成部分），以生产效率交互为用（日常操作面）。

背景偏差澄清：PRD 说痛点是"重复加工劳动"（生产效率线索），章程价值主张是"内容改起来、资产传下去"的确定性（资产管理线索），两线索长期并行未拍透，UI 的拧巴（档案柜骨架配效率口号）即此症状。本设计裁定：

- **体 = 路线二（资产血缘管理）**：三态分离、ZONE 状态机、母版唯一事实源、血缘表——全部保留不动；"明确哪些是优质内容"依赖发布回流数据（§4 预留位）。
- **用 = 路线一（生产效率）**：派生动作本身即生产动作，UI 以"工作台+派生流水线"为第一交互面。
- 全过程生产自动化已被 KNW-EXP-001 划界（L-001/L-002/L-007：剪辑归人工、创意决策不进主管线），中游制作在系统外由人完成，系统不做中游自动化（维持 PRD 红线）。

*实施时回填 PRD-MVP-001 §3，消除两文档表述偏差。*

## 2. 信息架构

### 2.1 导航（6 项 → 4 项）

| 新导航 | 路由 | 职责 | 来源 |
|--------|------|------|------|
| 工作台（默认） | `#/today` | 回答"现在该干什么"：待处理 + 进行中 | 新建；吸收驾驶舱统计 + M3 primaryTask |
| 派生流水线 | `#/pipeline` | 母版→批量产物→逐个确认的核心生产线 | 新建 |
| 资产档案 | `#/archive` | 查档：跨区单表全量检索 | 合并原四区页（M4–M7 能力全保留） |
| 提示词库 | `#/recipes` | 模板与提示词管理 | 原样保留 |

- **驾驶舱退役**：指标卡压缩为工作台顶部一行轻量统计条（资产总数/在途 run 数/本周发布数），页面删除。
- 四区（source/topic/master/publish）从"页面"降级为"档案页过滤器"；`ZONE_STATUSES`/`ZONE_TRANSITIONS` 仍是状态合法性唯一权威，从"页面组织者"变为"流水线的合法性基础"。
- 技术栈不动：Tailwind v4 + shadcn 组件体系（M5）完整复用；1180 行 App.tsx 拆为 `pages/` 目录 + 路由表驱动。深链路由（M8 候补 2）并入本次实施，不再单列。

### 2.2 与编排内核的关系（UI 先行、内核并行）

本设计与 [EA-ARC-001](EA-ARC-001-dify-workflow-study-notes.md) 编排内核是同一洞察的两端：内核的 run/确认点正是效率 UI 缺的主干。分工：

- **阶段一（本设计）**：基于现有 API + 最简 run 两表交付全部 UI；后端批量执行用 BackgroundTasks（PRD §6"规模上来再引入队列"）。
- **阶段二（内核落地）**：EA-ARC-001 五表替换阶段一的先导表，产物确认原位升级为真确认门；UI 组件契约按 run 形状设计，只换数据源不换组件。

## 3. 工作台（双栏关注流）

```
┌─────────────────────┬─────────────────────┐
│ ⏳ 待你处理 (N)      │ ⚙ 进行中 (M)         │
│  [定稿] 母版 drafting│  [生成中] run 产物格 │
│  [确认] 产物 done    │  [生成中] run 产物格 │
│  [登记] publish 缺链 │ ✓ 最近完成           │
│  [推进] 选题候选     │  昨天发布的…         │
└─────────────────────┴─────────────────────┘
```

- **左栏"待你处理"**：按状态机推导，不新增后端表——待定稿（母版 drafting）、待收下（run 产物 done 未 confirmed）、待登记（publish publishing 且无链接）、待推进（选题 candidate/researching）。前三类复用 M3 `primaryTask` 推导逻辑（frontend/src/lib/primary-task.ts），从详情页埋点升级为首页聚合。每条点击直达对应操作位置。
- **右栏"进行中"**：活跃 run 及其产物进度；下方"最近完成"（近 7 天 published/confirmed）。
- 顶部统计条：资产总数 / 在途 run 数 / 本周发布数（原 /api/meta/stats 聚合）。
- "可启动"建议组（母版定稿 N 天未派生）**阶段一不做**，滚入 M8 候补池。

## 4. 派生流水线（Run 卡片板，产品核心页）

### 4.1 交互形态

页面 = 活跃 run 卡片列表，一次派生 = 一张卡，卡内自含全部阶段（无向导步骤页）：

- **发起**：母版详情页主按钮"派生到全平台"，或本页"＋新建派生"→ Dialog 内勾选产物组（四平台封面 / 口播稿 / GEO 变体 / 语音包，各 allowing 多选/参数）。
- **产物网格**：每产物一格，状态 `queued→running→done/failed` 可视；done 格内联 **收下**（confirmed 标记）与 **↻ 重生成**（同参数追加新产物，旧产物保留在血缘中可对比）。
- **刷新**：run 活跃期 3s 轮询，卡片静止后停。
- 参照 ClipFlow 的"中间产物可操作"手感；卡片板即未来内核 confirmation 的直系 UI。

### 4.2 数据模型（阶段一新增两表）

```sql
CREATE TABLE pipeline_run (
  id uuid PRIMARY KEY,
  master_asset_id uuid NOT NULL REFERENCES assets(id),
  status text NOT NULL,            -- running / completed / failed
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE run_product (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES pipeline_run(id),
  kind text NOT NULL,              -- cover / script / geo / videokit
  params jsonb NOT NULL,           -- 平台/提示词id/音色等
  status text NOT NULL,            -- queued / running / done / failed
  asset_id uuid REFERENCES assets(id),  -- 产物入库后回填
  confirmed boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- **执行**：BackgroundTasks 逐产物调用现有 `rendering.py` / `llm.py` / `speech.py`+`subtitles.py` 模块（与现有同步端点相同逻辑），产物完成即入库并记血缘（沿用 Derivation）。
- **契约预留（接缝）**：阶段一"生成即入库、收下是标记"；内核落地后原位升级为"生成暂存 → 确认才入库"，UI 组件不变。`run_product` 与 EA-ARC-001 `pipeline_node_execution` 的字段对齐（status/error/耗时），届时迁移不废弃。
- LLM 步骤产物在生成时已落库计费，重生成是显式新产物，无隐藏重复计费。

## 5. 资产档案（单表全量）与详情升级

- **列表**：`GET /api/assets` 支持省略 zone 返回全量；分区/类型/状态三组筛选 chips 可组合，状态词表随所选分区联动（`ZONE_STATUSES` 映射）。表格列沿用 52842b0 结构（编号/名称/状态/属性/操作），新增"分区"徽标列。
- **详情页**：布局沿用 DetailPageLayout，两处升级——
  1. **血缘区从 UUID 字符串升级为可点击资产卡**（上游/下游：标题+状态徽标，点击跳转该资产详情）——资产血缘体系"体"的视觉宣言；
  2. **发布回流数据预留位**：发布登记模型预留阅读/互动回流字段（阶段一只做数据模型占位，不做 UI）——为"明确哪些是优质内容"补数据腿。
- 母版详情新增主按钮"派生到全平台"（§4.1 发起入口）。

## 6. 实施顺序与验收

1. 后端：run 两表 + 批量派生端点 + assets 全量查询；
2. 前端壳：四项导航 + 工作台 + 档案页（先行可见，不干扰其余）；
3. 流水线卡片 + 发起 Dialog + 详情页升级；
4. App.tsx 拆分与路由迁移收尾。

- 测试：现有前端测试（primary-task / attr-summary 等）适配迁移；run 状态机、筛选联动、工作台待办推导补新测试。
- **M3–M7 UX 走查暂停**：原验收对象（四区列表+详情）被本重设计取代，验收改为新 UI 上的同等能力走查；M0–M2 已验收后端能力不受影响。
- M8 候补池更新：候补 2（深链路由）并入本设计；新增候补"可启动建议组"。

## 7. 明确不做（本设计边界）

- 不做向导式分步流水线（评审否决：日常高频场景仪式感过重）；
- 不做内核的完整五表/事件表/SSE（属 EA-ARC-001 阶段二，本文只留接缝）；
- 不做中游制作自动化（剪辑/成片，维持 PRD 红线与 KNW-EXP-001 边界）；
- 不做"可启动"智能建议（阶段一裁剪，滚入候补）；
- 不动 Recipe 单版本模型（提示词版本化属 EA-ARC-001 §4 范畴，另行立项）。

## 变更记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-10-28 | 初版：体用定性、三区骨架、双栏工作台、Run 卡片板、单表档案、run 两表先导与内核接缝（draft，待审） | zhoudabo |
