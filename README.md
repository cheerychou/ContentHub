# ContentHub

面向企业/平台的 **AI-Native 数字内容供应链系统（A-DCSC）** —— 内容"存储、制作、管理、分发"全链路。

> ⚠️ 本仓库处于**方案/草案起步阶段**：M0 资产底座已可自托管运行，后续工程能力待业务定型后逐步落地。

## 📚 文档

进入 [docs/README.md](docs/README.md) 文档中心；全套文档采用统一编号体系见 [FND-GOV-001](docs/00-foundation/governance/FND-GOV-001-numbering-system.md)。

## 快速开始（应用）

```bash
make up                 # postgres + minio + api + frontend
open http://localhost:8080
# 导入既有 Obsidian 内容库
make import VAULT="/path/to/【008】个人文章"
```

> 注：compose 将 api 映射到宿主机 **8001**（本机 8000 已被占用，见 `docker-compose.yml`）；前端 8080、minio 9000、postgres 5433。

开发：`make dev`（仅起 postgres/minio）→ `cd backend && .venv/bin/pytest -v`。

## 快速开始（文档规范）

- 新建编号文档：`python3 scripts/docstd --docs ./docs new <CAT> <DOM> <slug> --title "中文标题"`
- 校验：`python3 scripts/docstd --docs ./docs check`
- 重建索引：`python3 scripts/docstd --docs ./docs index`

> 类别词表、生命周期与治理原则（小索引·单一权威 + 三问）均见 [FND-GOV-001](docs/00-foundation/governance/FND-GOV-001-numbering-system.md)。

## 提交 / 推送

无 CI/CD 门禁：本仓库不上传 GitHub Actions。仅本地 pre-commit 做文档命名预检（可随时 `git config --unset core.hooksPath` 关闭）。
