FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic
RUN pip install --no-cache-dir .
RUN pip install --no-cache-dir playwright && playwright install --with-deps chromium
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed_recipes && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
