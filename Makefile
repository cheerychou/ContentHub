.PHONY: dev test preflight cleanup-orphans backfill-attrs up down import

FILTER ?= --dry-run

dev:            ## 启动开发依赖（postgres + minio）
	docker compose up -d postgres minio

test:           ## 运行后端测试（需先 make dev）
	cd backend && .venv/bin/pytest -v

preflight:      ## 本地质量门禁（无 CI 红线下的替代闸）：文档规范 + 全部测试 + 迁移可升级
	python3 scripts/docstd --docs ./docs check
	cd backend && .venv/bin/pytest -q
	cd backend && .venv/bin/alembic upgrade head

cleanup-orphans: ## 对象存储孤儿清理：默认 dry-run；make cleanup-orphans FILTER=--delete 真删
	cd backend && .venv/bin/python -m scripts.cleanup_orphans $(FILTER)

backfill-attrs: ## 存量资产属性回填：默认 dry-run；make backfill-attrs FILTER="--apply" 写入（--force 重抽）
	cd backend && .venv/bin/python -m scripts.backfill_attrs $(FILTER)

up:             ## 全栈构建并启动
	docker compose up -d --build

down:
	docker compose down

import:         ## 导入 Obsidian 库：make import VAULT="/path/to/【008】个人文章"
	cd backend && .venv/bin/python -m app.importer.obsidian --vault "$(VAULT)"
