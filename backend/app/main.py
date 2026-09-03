from fastapi import FastAPI

from .routers import assets

app = FastAPI(title="ContentHub API", version="0.1.0")
app.include_router(assets.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}
