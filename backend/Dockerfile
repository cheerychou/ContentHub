FROM python:3.12-slim
WORKDIR /app
# M7：音视频属性抽取依赖 ffprobe；apt 层置于 pip 层之前（pyproject 变更更频繁，利于缓存）。
# 官方 deb.debian.org 链路在本环境间歇 502/超时，改用阿里云镜像
RUN sed -i 's|http://deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic
RUN pip install --no-cache-dir .
RUN pip install --no-cache-dir playwright && playwright install --with-deps chromium
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed_recipes && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
