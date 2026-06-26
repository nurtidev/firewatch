from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://firewatch:firewatch@db:5432/firewatch"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    ml_url: str = "http://ml:8000"
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    jwt_secret: str = "dev-secret"

    # Pilot bounding box (Astana). Used by the OSM import job.
    city_name: str = "Astana"

    # Where uploaded operational-card files are stored (Module 03).
    uploads_dir: str = "/app/uploads"

    # Module 05: 10-min normative arrival → ~3.5 km road reach (straight-line
    # approximation until OSRM isochrones replace it).
    coverage_radius_m: int = 3500
    arrival_normative_min: int = 10


settings = Settings()
