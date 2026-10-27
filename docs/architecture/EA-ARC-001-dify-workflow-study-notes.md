---
doc_id: EA-ARC-001
title: Dify 工作流引擎源码研读设计笔记
category: EA
domain: ARC
status: draft
version: 1.0
author: zhoudabo
created_at: 2026-10-27
updated_at: 2026-10-27
tags: [编排内核, Dify, 源码研读, 暂停恢复, Human-Input, 事件契约, 版本模型]
related: [STR-BV-001, PRD-MVP-001, KNW-EXP-001]
---

# Dify 工作流引擎源码研读设计笔记

> **目的**：为 ContentHub 自研"产品化最小编排内核"（固定管线 + 3 个人工确认点）提供参照架构。
> **方法**：精读 Dify 1.18.0 源码（`api/pyproject.toml:3`；commit `50abea97`），四路专题并行（图引擎/暂停恢复、Human Input 表单、事件契约/续流、版本模型/配置面），全部结论带 file:line 证据。
> **关键发现**：1.18.0 引擎本体已抽为独立包 `graphon==0.8.0`（api/pyproject.toml:49，锁 git rev `4fa22141`），已按锁定 rev 克隆精读（临时目录 `/tmp/graphon-src`，复核可重克隆）。
> **约束前提**：无 Celery/Redis、Postgres 单库、管线在代码中固定、前端为自有 UI（Dify 界面永不出现）。

## 0. 总体结论（TL;DR）

1. **路线验证**：Dify 自己在 1.13→1.18 的演进方向（引擎抽包、引擎只管执行/宿主管持久化）恰好证明"编排引擎可以很小"。我们的固定管线是它的特例（单线程顺序图），复杂度断崖式下降，但**核心语义可以完整保留**。
2. **四个可直接照抄的语义契约**（本文档 §2–§5）：
   - 暂停 = 记住"当前步 + 变量池"，恢复 = 重跑该步并注入已提交数据（不持久化调用栈）；
   - "一次提交" = `FOR UPDATE` 行锁 + `status='waiting'` 条件转移，非法提交只返回 400 不改状态；
   - `continue_on_pause` 的本质 = 终态事件集合参数化（paused 是否算流终点）；
   - 双层超时先到者赢（节点级走超时分支，全局硬顶终止 run）。
3. **一个反超点**：Dify 因"HTTP 进程 ≠ Celery worker"被迫用 Redis Pub/Sub 扇出且事件不落库，断线重连默认丢中间事件、需"从节点执行表反推快照"补偿。我们的单机 Postgres **事件表天然是持久队列**，重连 = 按 offset 补读——更简单且更可靠。
4. **资产版本化直接受益**：Dify 的 version_number 计数器 + 发布原子指针 + 运行时快照冗余三件套，正好落地"提示词即资产"的版本化（§6.4）。

## 1. 图引擎与暂停-恢复（来源：graphon + Dify 宿主）

### 1.1 模块地图

| 组件 | 位置 | 职责 |
|------|------|------|
| 引擎入口 | graphon `engine/engine.py`（416 行） | run() 编排；resume 重入（:337-383）；终态事件（:279-324） |
| 事件分发 | graphon `engine/dispatcher.py` | 单线程分发；暂停时收敛 worker、延迟未启动任务（:117-174） |
| 帧内调度 | graphon `engine/scheduler.py` | 边状态机与分支传播（:47-90, 199-371） |
| 事件落地 | graphon `engine/event/processor.py` | 节点事件、暂停处理（:250-262）、失败/重试/异常分支（:272-299） |
| 运行时状态 | graphon `runtime/runtime_state/{state,snapshot,v3}.py` | 快照编解码（纯 JSON，v1/v2/v3 带版本迁移） |
| Dify 宿主适配 | api `core/workflow/workflow_entry.py` | 构造 Engine（:159-163）、事件过滤（:73-96） |
| 暂停落库 | api `services/workflow_run_agg.py:324-379` | 引擎静默后写 workflow_pauses + 对象存储状态 |
| 恢复任务 | api `tasks/app_generate/workflow_execute_task.py:488,791` | Celery `resume_app_execution`：载快照→行锁置 RUNNING→重入引擎 |

### 1.2 核心机制

- **图表示**：`Edge={tail, head, source_handle, state}`（graphon `graph/edge.py:7-15`）；执行是**队列 + 事件驱动**而非单遍拓扑：worker 执行节点 → 事件 → Dispatcher → Scheduler 推进；join 语义 = "所有入边已定且任一 TAKEN"（scheduler.py:72-90），未选分支递归传播 SKIPPED。
- **暂停语义 = 重跑当前节点**：Human Input 节点回调未获表单 → `PauseRequested`（api `nodes/human_input/callback.py:100-124`）→ 引擎把**该节点状态重置 UNKNOWN 并放入 deferred 队列**（graphon `event/processor.py:250-262`）。不持久化调用栈，只持久化数据 + 任务队列。
- **快照内容**（graphon `runtime/runtime_state/v3.py:19-60`）：变量池、就绪队列、图执行状态（paused + reasons）、每节点/边状态、迭代子帧、输出与用量——**纯 JSON、无协程栈、带版本号**。
- **落库时机与位置**：引擎完全静默后由宿主写入（保证一致性，workflow_run_agg.py:233 注释）：状态 JSON 存对象存储（`workflow-state-{uuid}.json`），DB 记 `workflow_pauses` + `workflow_pause_reasons`，run 置 PAUSED（repository:1101-1150, 1153）。
- **恢复链路**：提交表单 → `mark_submitted` → 入队恢复（human_input_service.py:248-311）→ Celery worker 读 pause → `RuntimeState.from_snapshot` → 行锁 `resume_workflow_pause` 置 RUNNING + resumed_at（repository:1498-1582）→ 引擎 resume：deferred 任务重新入队 → **重跑 Human Input 节点**，此时回调见表单已提交 → `Completed(selected_handle=提交的动作)`（callback.py:131-153）→ 图继续 → 删 pause 行。

### 1.3 设计决策与理由

1. **引擎/宿主分离**：graphon 只管执行，持久化归宿主——引擎保持纯粹，宿主自由选择存储。
2. **暂停选在"引擎静默点"**：worker 收敛、无在途事件时才落快照，一致性靠时机而非分布式事务。
3. **"恢复 = 重跑该步"**：节点执行函数必须幂等（业务回调决定继续还是再暂停），换来极简的恢复协议。
4. **事件流与状态分离**：SSE 可断，续流用 DB 重建 + 实时接续，天然支持刷新/换端。
5. **大状态放对象存储、DB 只存指针**：避免高频大字段。

## 2. Human Input 表单生命周期

### 2.1 数据模型（Dify 5 张表 → ContentHub 1 张）

Dify：`human_input_forms`（含 `form_definition` JSON 快照 + `rendered_content` + status + expiration_time + submitted_data，api/models/human_input.py:28-90）、`_deliveries`、`_recipients`（**form_token 在这张表**：22 字符随机串 unique，token = 收件人身份凭据，:216-275）、`upload_tokens`、`upload_files`；暂停态另存 `workflow_pauses`（含 form_id、state_object_key）。

### 2.2 状态机（单向一次）

```text
WAITING ──mark_submitted（FOR UPDATE 行锁 + status=='WAITING' 条件转移，repository:663-678）──> SUBMITTED（终态 → 恢复流程）
   ├──节点级超时（默认 36h）──> TIMEOUT（走 __timeout 边恢复）
   └──全局超时（HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=7d）──> EXPIRED（run 终止，永不恢复）
```

- "提交成功即终结"：行锁 + 条件转移原子完成；已提交后再访问抛 412（service:255-264，代码注释 "Forms are one-shot"）；超时扫描对已提交表单跳过（repository:707-708）。
- **被拒提交**（action 非法 / 缺必填 / select 越界）：400，表单保持 WAITING 可重试，不落库（entities.py:348-363）。

### 2.3 关键设计决策

1. **定义与运行时分离**：暂停瞬间把节点配置物化为 `FormDefinition` JSON 快照 + 已渲染内容（callback:155-183）；Select 的变量选项创建时固化为常量（policy:117-160）。恢复/展示**永不依赖变量池重算**。
2. **token 即身份**：不透明随机串，校验 token→recipient→form 链 + 归属；归属不符**一律 404 不 403**（防 token 枚举，openapi:51-72）。无 "user_id 存 token 行" 的显式绑定，最小权限靠 surface 白名单（policy:27-31）。
3. **动作即边**：`UserActionConfig.id` 同时是输出分支句柄；提交后 `Completed(selected_handle=action_id)` 由引擎选边（callback:149-153）。
4. **下游变量三件套**：`__action_id` / `__action_value` / `__rendered_content`（提交值回填占位符，file→"[file]"/"[N files]"，callback:204-261, 315-326）。
5. **双层超时先到者赢**：节点级走超时分支恢复；全局过期视为非法恢复状态直接终 run（callback:60-66, 196-204；timeout_tasks:92-107）；提交回调兜底再查全局 deadline。
6. ⚠️ **文档 vs 代码差异**：官方文档称"Trigger 启动的工作流不支持 web app 投递"，但 1.18.0 代码未见对 `InvokeFrom.TRIGGER` 的显式剥除（仅 debugger/explore 分支剥除 + WorkflowTool 上下文整体禁用 Human Input，workflow_tool_source_service.py:114-115）。**列入 PoC 实测清单**。

## 3. 事件契约与续流

### 3.1 事件清单（Workflow app，对齐 Service API 文档）

| 事件 | 触发点 | 关键字段 |
|------|--------|---------|
| ping | 连上即发 + 每 ~10s 心跳（streaming_utils.py:25,44-46） | —— |
| workflow_started | run 开始 | id, inputs, created_at |
| node_started / node_finished / node_retry | 节点生命周期 | id, node_id, node_type, status, error, elapsed_time, index |
| human_input_required | 暂停时**逐表单**生成（workflow_response_converter.py:377-403） | form_id, node_id, form_content, inputs[], actions[], form_token, approval_channels[], expiration_time |
| workflow_paused | 暂停终态 | paused_nodes[], reasons[]（内嵌 form_token/expiration_time）, status |
| human_input_form_filled / _timeout | 提交后恢复入队 / 超时巡检 | form_id, action_id, submitted_data / expiration_time |
| workflow_finished | run 终态 | status, outputs, elapsed_time, total_steps, finished_at |
| error | 失败 | code, message |

线格式（base_app_generator.py:323-328）：业务事件 = `data: {JSON}\n\n`（事件名在 JSON 内 `event` 字段）；仅 ping 用裸 `event: ping`。**顺序约定：`human_input_required` 先于 `workflow_paused`，活流与重连一致**（避免重连前后 schema 漂移）。

### 3.2 续流语义

- `GET /workflow/{run_id}/events`：tenant/app/user 校验**全部 404**（workflow_events.py:109-119）；已结束的 run 只回单条 workflow_finished 即关（:123-136）。
- 默认 terminal 集合 = `{workflow_finished, workflow_paused}`——**第一个暂停即关流**；`continue_on_pause=true` ⇒ terminal 置空集（:149），只认 workflow_finished 或 300s idle 超时。
- `include_state_snapshot=true`：从持久层**确定性合成**事件序列（workflow_started → 逐节点 started/finished ← 节点执行表 → 仅 status=WAITING 的表单发 human_input_required ← 防重放已提交表单 → workflow_paused），再接续实时流（snapshot service:176-237, 475-498）。

### 3.3 对 ContentHub 的关键判断：事件表优于 Pub/Sub

Dify 事件流**不落库**（落库的是 run/节点执行/暂停态），Pub/Sub 是 fire-and-forget，重连默认只能 tail、中间事件永久丢失，才被迫发明"快照合成"补偿。我们的后端与 API 同进程，**事件表天然是持久队列**：

```sql
CREATE TABLE pipeline_event (
  id          BIGSERIAL PRIMARY KEY,        -- 全局单调，重连游标(offset)
  run_id      UUID NOT NULL,
  seq         INT  NOT NULL,                -- run 内序号
  event       TEXT NOT NULL,                -- 与 Dify 事件名对齐
  payload     JSONB NOT NULL,               -- 字段对齐 Dify data
  terminal    BOOLEAN NOT NULL DEFAULT false,  -- finished/paused 标记
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq));
CREATE INDEX ON pipeline_event (run_id, id);
```

- 推送：`INSERT ... RETURNING` 后 `pg_notify('pipeline_events', run_id||':'||id)`；SSE handler LISTEN + 空闲 2~5s 轮询兜底（**通知不承载语义，只降延迟**）。
- 重连 = `SELECT WHERE run_id=? AND id>?` 补读 + 接续 LISTEN；无需任何补偿式快照合成。
- 校验照抄"不匹配一律 404"；保留策略 `DELETE WHERE created_at < now()-'30 days'` 每日任务。
- **续流进一步退化**：节点完成即写执行记录（事件溯源），前端刷新页面直接 GET 执行详情渲染即可，SSE 仅作实时性增强。

## 4. 版本模型与提示词资产化

Dify：`workflow` 表单表同构 draft/published（draft 行 version 恒为 `'draft'`，published 行 = 时间戳串）；`version_number` 人读 `#N` 由每 app 计数器行 **PG upsert 行锁 + RETURNING 分配、永不复用**（workflow_version_number_service.py:28-52）；发布 = 插新行 + 同事务原子切换 `App.workflow_id` 指针（workflow_service.py:750-765）；`WorkflowRun` 再冗余 graph 快照——**发布后改动不影响历史 run**；草稿乐观锁用 `unique_hash` 比对（workflow_service.py:412,445-446）；"版本恢复" = 把已发布行拷回草稿行（workflow_restore.py:18-58）。

ContentHub 管线在代码里，不需要画布与 draft/published 双行；**只借三件事**：

```sql
-- 提示词版本（不可变，append-only）
CREATE TABLE prompt_version (
  id uuid PRIMARY KEY,
  prompt_id uuid NOT NULL,
  version_number int NOT NULL,          -- 行锁计数器分配，永不复用
  template jsonb NOT NULL,              -- 模板正文 + 变量 schema
  content_hash text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, version_number));
CREATE TABLE prompt_version_counter (
  prompt_id uuid PRIMARY KEY, last_version_number int NOT NULL);
-- prompt（活文档）: id, slug, current_version_id（发布指针）, draft jsonb, content_hash（乐观锁）

-- 生成记录绑定版本（快照冗余：代码管线升级不破坏历史可复现性）
CREATE TABLE generation_record (
  id uuid PRIMARY KEY,
  pipeline_id text NOT NULL,            -- 固定管线标识，如 'article.v1'
  prompt_bindings jsonb NOT NULL,       -- {"writer":{"prompt_id":…,"version_number":7},…}
  run_id uuid,                          -- 关联编排内核 run
  inputs jsonb, outputs jsonb, status text,
  created_at timestamptz NOT NULL DEFAULT now());
```

发布 = 插版本行 + 原子更新 `current_version_id`；编辑只碰 `draft` 列。这把 PRD §3.2"提示词即入库资产 + 血缘记录"落到了表结构上。

## 5. ContentHub 编排内核设计草案（综合）

### 5.1 数据模型（五张表，全部 Postgres）

| 表 | 职责 | 对应 Dify |
|----|------|-----------|
| `pipeline_run` | 一次编排运行：status(running/paused/succeeded/failed/stopped/timeout)、pipeline_id、current_step、变量池 jsonb、created_by | workflow_runs + workflow_pauses |
| `pipeline_node_execution` | 每节点一行 append-only：step、attempt、status、inputs/outputs、error、耗时 | workflow_node_executions |
| `confirmation` | 人工确认单：form_definition jsonb 快照、rendered_content、status(waiting/submitted/timeout/expired)、expiration_time、selected_action_id、submitted_data、token | human_input_forms + recipients（合并） |
| `pipeline_event` | 事件表（§3.3 schema） | （Dify 无——其优势所在） |
| `prompt_version` / `generation_record` | 提示词版本化 + 生成血缘（§4） | workflow + workflow_runs 快照思想 |

### 5.2 运行时形态

- **执行器**：asyncio 顺序执行固定管线（无并行分支 ⇒ 不需要边状态机/worker 线程池/就绪队列）。
- **暂停**：确认点 = 记 `current_step` + `confirmation` 行（定义快照）+ 事件表写 `human_input_required` → `workflow_paused`（terminal 标记）→ 原始推送关闭。
- **恢复**：提交确认（行锁 + 条件转移）→ `UPDATE run SET status='queued'` → 常驻 worker 进程 `SELECT … FOR UPDATE SKIP LOCKED` 认领（Dify 行锁思想的最简替代，无 Celery）→ 重跑该步并注入 `submitted_data`（即"暂停 = 重跑当前步"语义）。
- **超时**：asyncio 周期任务（或 pg_cron）跑 `WHERE status='waiting' AND expiration_time<=now() LIMIT n`，幂等条件更新；节点级超时走超时分支、全局硬顶终止 run；提交路径兜底再查 deadline。
- **事件推送**：pg_notify + LISTEN，轮询兜底；`continue_on_pause` 语义保留为 SSE 端点的 terminal 集合参数。

### 5.3 与现有系统的对接（编排权归属）

- `pipeline_run` 只记"这一次运行跑到哪"；**资产状态（ZONE_STATUSES/ZONE_TRANSITIONS）仍是唯一事实源**，两者以 run_id/资产 ID 关联。管线步骤的成功回调推动 ZONE 状态流转（如选题立项、母版定稿），编排状态与资产状态**单向依赖、不双写**。
- 确认点的"驳回/重新生成"= Dify 的动作分支 + 错误分支重试模型（attempt 计数 + 间隔）。
- 步骤执行直接复用现有模块：`llm.py`（文本）、`rendering.py`（封面，坚守 L-004 模板渲染路线）、`speech.py`/`subtitles.py`（语音包，坚守 L-001 断句独立步骤）。

### 5.4 明确不做（平台性组件）

画布/可视化编排、通用图引擎（并行分支/迭代循环节点）、Celery/Redis、插件系统、多租户、多端表单投递（deliveries/recipients 合并为单 internal 收件人）、draft/published 双行画布模型、对象存储状态 blob（状态直接存 PG jsonb）。若未来出现"用户自定义编排"需求，本文档即为设计输入。

## 6. PoC 验证清单（含未确认项）

1. **三层超时/恢复语义对齐**：自研内核 vs 一次性 Dify 实例（oracle）同跑"生成→暂停→提交/超时→恢复→完成"，对照事件序列与状态终态。
2. Trigger 启动的工作流 + web app 投递是否真被拒绝（§2.3-6 文档/代码差异）。
3. graphon 多个人工输入并行挂起时的 join 恢复细节（`test_parallel_human_input_join_resume.py` 存在，未逐行验证）——ContentHub 固定管线无并行，仅作认知参考。
4. 内核本身：行锁一次提交、SKIP LOCKED 认领、pg_notify 断线补读、超时幂等扫描。

## 7. 证据与可复核性

- 源码：Dify 1.18.0（commit `50abea97`）克隆于 `/Users/zhoudabo/应用开发/dify-ref`（项目外参考目录，只读）；引擎包 graphon 0.8.0（rev `4fa22141`）克隆于 `/tmp/graphon-src`（临时，复核重克隆）。
- 本文所有 file:line 引用出处于四份精读笔记（图引擎/暂停恢复、Human Input 表单、事件契约/续流、版本模型/配置面），研读日期 2026-10-27。

## 变更记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-10-27 | 初版：四路源码精读综合，含内核设计草案与 PoC 清单（draft，待审） | zhoudabo |
