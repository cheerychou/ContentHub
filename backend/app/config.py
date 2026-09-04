from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+psycopg://contenthub:contenthub@localhost:5433/contenthub"
    )
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "contenthub"
    minio_secret_key: str = "contenthub123"
    bucket_prefix: str = "contenthub-"
    llm_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    llm_api_key: str = ""
    llm_model: str = "glm-4-flash"

    model_config = {"env_file": ".env", "env_prefix": "CH_"}


settings = Settings()
