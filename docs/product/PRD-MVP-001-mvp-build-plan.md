---
doc_id: PRD-MVP-001
title: 数字内容供应链系统(A-DCSC) MVP建设方案
category: PRD
domain: MVP
status: draft
version: 1.0
doc_type: prd
author: zhoudabo
created_at: 2026-09-03
updated_at: 2026-09-04
tags: [MVP, 三态分离, 血缘, MinIO, OpenMetadata, Neo4j]
related: [STR-BV-001]
---

# 数字内容供应链系统（A-DCSC）MVP 建设方案

> **文档状态**：草案，评审中
> **来源注记**：由独立草稿《MVP建设方案》规范化而来，属 A-DCSC 第一期（MVP，侧重存储与血缘）的落地一体化方案；整体愿景见 [STR-BV-001](../strategy/STR-BV-001-digital-content-supply-chain-vision.md)。

## 1. MVP产品定义与范围

### 1.1 产品定位
本MVP旨在验证 **"AI-Native智能内容供应链"** 的核心管理理念，不追求大而全的功能覆盖，而是聚焦于解决内容资产**存储混乱**与**血缘关系丢失**这两个最基础的痛点。

### 1.2 MVP核心目标
1. **实现"三态分离"**：在存储层面建立逻辑隔离的素材区（原子态）、半成品区（编辑态）和制成品区（发布态）。
2. **建立"血缘图谱"**：能够记录并展示一个文件（如JPG）是由哪个原始文件（如RAW）加工生成的。
3. **验证技术路径**：证明基于开源工具链（Python + MinIO + OpenMetadata）构建核心系统的可行性。

### 1.3 MVP功能范围（一期）

| 功能模块       | 核心功能                                                     | 优先级 |
| :------------- | :----------------------------------------------------------- | :----- |
| **资产上传**   | 支持通过API或简单界面，将文件上传至指定区域。                | 必须   |
| **三态存储**   | 在MinIO中划分三个独立的Bucket。                              | 必须   |
| **血缘记录**   | 在上传或处理文件后，由后台服务自动记录"由谁生成"的关系。     | 必须   |
| **图谱展示**   | 通过OpenMetadata或Neo4j的界面，查看资产的上下游关系。        | 必须   |
| **自动化处理** | 上传后自动触发简单的转码或缩略图生成（作为血缘生成的触发源）。 | 次要   |

## 2. MVP技术架构蓝图

### 2.1 整体架构分层
架构设计延续了"四层能力模型"，但MVP阶段侧重实现底层存储和基础服务层，上层应用保持轻量化。

| 架构层级           | 核心组件              | 开源选型                | 职责                                                         |
| :----------------- | :-------------------- | :---------------------- | :----------------------------------------------------------- |
| **用户交互层**     | API网关 / Web UI      | FastAPI + 轻量级前端    | 提供文件上传、查询接口，以及与用户交互的管理界面。           |
| **任务编排层**     | 异步任务队列          | Celery / Apache Airflow | 处理耗时的文件处理、元数据提取和血缘记录任务。               |
| **元数据与血缘层** | 元数据中心 + 图数据库 | OpenMetadata + Neo4j    | 存储所有资产的元数据（名称、类型、标签）以及它们之间的血缘关系。 |
| **内容存储层**     | 对象存储              | MinIO                   | 存储所有物理文件，并根据"三态"原则进行逻辑隔离。             |

### 2.2 核心选型理由
- **MinIO**：开源、兼容S3 API、支持Docker快速部署，是搭建私有对象存储的首选。
- **OpenMetadata**：开源元数据管理平台，开箱即用，具备资产目录、数据血缘和搜索功能，能很好地扮演"资产大脑"的角色。
- **Neo4j**：原生图数据库，处理复杂的节点（资产）和关系（血缘）查询效率极高，非常适合构建血缘图谱。
- **Celery**：Python技术栈最成熟的分布式任务队列，易于与FastAPI集成，用于处理文件转码等异步任务。

## 3. MVP核心实现流程

### 3.1 环境部署（基于Docker Compose）
所有核心服务均可通过Docker Compose一键启动，大幅降低部署门槛。关键的`docker-compose.yml`服务包括：

```yaml
services:
  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    command: server /data --console-address ":9001"
  neo4j:
    image: neo4j:latest
    environment:
      - NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}   # 密码走 .env，不写死在 compose 里
    ports:
      - "7474:7474"
      - "7687:7687"
  openmetadata-server:
    image: openmetadata/server:1.3.0
    ports:
      - "8585:8585"
    # 含 OpenMetadata 所需的 MySQL/PostgreSQL、Elasticsearch 等服务
```

### 3.2 关键业务逻辑实现

#### 3.2.1 文件上传与三态存储 (FastAPI + MinIO)
这是系统入口。用户通过API指定文件要存入的区域（`/raw`、`/semi`或`/final`），服务将文件上传至对应的Bucket。

```python
# 伪代码示例
@app.post("/upload/{bucket_type}")
async def upload_asset(bucket_type: str, file: UploadFile):
    # 1. 校验 bucket_type 是否为 raw / semi / final
    # 2. 使用 MinIO SDK 将文件上传至对应桶
    minio_client.put_object(bucket_type, file.filename, file_data, length)
    # 3. 触发后续异步任务：记录元数据和血缘
    record_metadata_and_lineage.delay(bucket_type, file.filename)
    return {"status": "uploaded"}
```

#### 3.2.2 血缘关系的记录 (Celery + OpenMetadata + Neo4j)
当一个文件被上传（或由系统处理生成）时，后台任务会同步更新两个地方，以记录其"出生证明"：

1. 在OpenMetadata中创建资产条目：调用OpenMetadata SDK，在目录中创建该文件对应的`Table`或`Container`实体，并填充基本元数据。
2. 在Neo4j中建立图谱关系：如果该文件是某个已存在文件的衍生品（例如，`semi-finished`区的JPG是由`raw`区的RAW处理而来），则在Neo4j中创建两个节点，并用`GENERATED_FROM`关系将它们连接起来。

```python
# 伪代码示例
@celery_app.task
def record_metadata_and_lineage(target_file_info, source_file_info=None):
    # 1. 在 OpenMetadata 中创建资产
    asset_id = create_asset_in_openmetadata(target_file_info)

    # 2. 如果有源资产，在 Neo4j 中建立血缘关系
    if source_file_info:
        with neo4j_driver.session() as session:
            # MERGE 防止重复建节点；一次 run 只执行一条语句
            session.run(
                """
                MERGE (t:Asset {name: $target})
                MERGE (s:Asset {name: $source})
                MERGE (t)-[:GENERATED_FROM]->(s)
                """,
                target=target_file_info['name'], source=source_file_info['name']
            )
```

#### 3.2.3 血缘图谱的可视化查询 (Neo4j)
通过Neo4j自带的Browser界面，可以直接运行Cypher查询，直观展示资产的血缘网络。

```cypher
-- 查询某张图片的所有祖先（上游资产）
MATCH path = (a:Asset {name: 'product_final.jpg'})-[*..5]->(upstream)
RETURN path;
```

## 4. 注意事项与后续演进

### 4.1 MVP建设注意事项
- **元数据一致性问题**：OpenMetadata和Neo4j存储了部分重叠信息（如资产名称），需要确保两者同步。建议将OpenMetadata作为主数据源，Neo4j仅存储血缘关系。
- **血缘触发点的设计**：初期可手动或通过监听MinIO的Bucket事件来触发血缘记录任务，避免引入复杂的文件系统监控。
- **用户界面体验**：MVP阶段可暂不开发定制化UI，直接利用OpenMetadata和Neo4j的界面进行查询和管理，以降低工作量。

### 4.2 后续演进方向（二期、三期）
- **接入AI加工能力**：在任务处理层集成OpenCV、FFmpeg或AI模型，实现自动裁剪、调色、字幕生成等功能。
- **血缘自动化解析**：利用AI技术自动识别文件的生成关系（例如，从视频文件名推断其来源），减少人工干预。
- **智能搜索与应用层**：引入向量数据库，实现基于语义的内容搜索，并提供更丰富的API供下游业务系统调用。

## 附录：关键技术参考

| 技术/工具        | 官方文档地址                                                 | 用途简介             |
| :--------------- | :----------------------------------------------------------- | :------------------- |
| **MinIO**        | https://min.io/docs                                          | 高性能对象存储       |
| **OpenMetadata** | https://docs.open-metadata.org                               | 统一的元数据管理平台 |
| **Neo4j**        | https://neo4j.com/docs                                       | 原生图数据库         |
| **Celery**       | https://docs.celeryq.dev                                     | Python分布式任务队列 |
| **FastAPI**      | https://fastapi.tiangolo.com                                 | 现代Python Web框架   |

## 相关文档

- [STR-BV-001 愿景与章程](../strategy/STR-BV-001-digital-content-supply-chain-vision.md)
- [FND-GOV-001 编号体系](../00-foundation/governance/FND-GOV-001-numbering-system.md)

## 变更记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-09-03 | 将独立草稿《MVP建设方案》规范化为编号文档并入治理 | zhoudabo |
| 1.1 | 2026-09-04 | 状态改为 draft；修正伪代码 Cypher 用法与 Neo4j 密码配置 | zhoudabo |
