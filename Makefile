.PHONY: dev test up down import

dev:            ## 启动开发依赖（postgres + minio）
	docker compose up -d postgres minio

test:           ## 运行后端测试（需先 make dev）
	cd backend && .venv/bin/pytest -v

up:             ## 全栈构建并启动
	docker compose up -d --build

down:
	docker compose down

import:         ## 导入 Obsidian 库：make import VAULT="/path/to/【008】个人文章"
	cd backend && .venv/bin/python -m app.importer.obsidian --vault "$(VAULT)"
