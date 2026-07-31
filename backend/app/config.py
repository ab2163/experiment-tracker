from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # WandB — set WANDB_API_KEY and WANDB_ENTITY in your .env (see .env.example)
    wandb_api_key: str = ""
    wandb_base_url: str = "https://api.wandb.ai/graphql"
    wandb_entity: str = ""  # your WandB team/entity, e.g. "my-team"

    # DB — swap to postgresql://user:pass@host/db in production. Back this file up
    # periodically; it holds all runs, experiments, run sets, commands and tickets.
    database_url: str = "sqlite:///./experiment_data.db"

    # Ingest window (ISO8601). Runs created before this are ignored.
    ingest_since: str = "2026-07-01T00:00:00Z"
    ingest_workers: int = 16


settings = Settings()
