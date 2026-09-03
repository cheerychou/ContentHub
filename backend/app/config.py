from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+psycopg://contenthub:contenthub@localhost:5432/contenthub"
    )
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "contenthub"
    minio_secret_key: str = "contenthub123"
    bucket_prefix: str = "contenthub-"

    model_config = {"env_file": ".env", "env_prefix": "CH_"}


settings = Settings()
