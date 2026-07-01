from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Insecure development defaults that must never reach production. If the process
# starts in production (FW_ENV=production) while any of these is still in effect,
# we fail fast instead of silently running with a forgeable JWT secret, the
# default DB password, or wide-open CORS.
_DEV_JWT_SECRET = "dev-secret"
_DEV_DB_URL = "postgresql+psycopg://firewatch:firewatch@db:5432/firewatch"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App-specific config is namespaced under FW_ (the documented form); the bare
    # name is also accepted for convenience. (Externally-owned vars like
    # DATABASE_URL / ANTHROPIC_API_KEY / JWT_SECRET stay un-prefixed by design.)
    #
    # Deployment environment. Set FW_ENV=production in the prod contour to enable
    # the safety checks below. Defaults to development for local work.
    env: str = Field("development", validation_alias=AliasChoices("FW_ENV", "ENV"))

    database_url: str = _DEV_DB_URL
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    ml_url: str = "http://ml:8000"
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    jwt_secret: str = _DEV_JWT_SECRET

    # Comma-separated allowed web origins for CORS ("*" = any, dev only).
    cors_origins: str = Field(
        "*", validation_alias=AliasChoices("FW_CORS_ORIGINS", "CORS_ORIGINS")
    )

    # Behind Cloudflare/reverse proxy: trust X-Forwarded-For for the real client
    # IP in the audit trail. Enable ONLY when a trusted proxy sets it (else it is
    # client-spoofable). Set FW_TRUST_PROXY_HEADERS=true in the prod contour.
    trust_proxy_headers: bool = Field(
        False,
        validation_alias=AliasChoices("FW_TRUST_PROXY_HEADERS", "TRUST_PROXY_HEADERS"),
    )

    # Access-token lifetime. Short by default (gov-contour); was 7 days.
    jwt_ttl_hours: int = Field(
        12, validation_alias=AliasChoices("FW_JWT_TTL_HOURS", "JWT_TTL_HOURS")
    )

    # Pilot bounding box (Astana). Used by the OSM import job.
    city_name: str = "Astana"

    # Where uploaded operational-card files are stored (Module 03).
    uploads_dir: str = "/app/uploads"

    # Module 03: mask phone numbers in the extracted `contacts` field before it is
    # persisted/returned, so ПДн of responsible persons is not stored in clear.
    # NOTE: the raw scan is still sent to the extraction vendor — masking here only
    # minimises PII at rest; eliminating cross-border transmission is a separate
    # legal/architecture track (on-prem/redacted model), not a code flag.
    mask_pii: bool = True

    # Module 05: 10-min normative arrival → ~3.5 km road reach (straight-line
    # approximation until OSRM isochrones replace it).
    coverage_radius_m: int = 3500
    arrival_normative_min: int = 10

    @property
    def is_production(self) -> bool:
        return self.env.strip().lower() in {"production", "prod"}

    @model_validator(mode="after")
    def _forbid_dev_defaults_in_prod(self) -> "Settings":
        if not self.is_production:
            return self
        problems = []
        if self.jwt_secret == _DEV_JWT_SECRET or len(self.jwt_secret) < 32:
            problems.append(
                "JWT_SECRET is the dev default or too short (need >=32 random chars)"
            )
        if self.database_url == _DEV_DB_URL:
            problems.append("DATABASE_URL is the dev default (firewatch:firewatch)")
        if self.cors_origins.strip() == "*":
            problems.append("CORS_ORIGINS is '*' (set explicit web origin[s])")
        if problems:
            raise ValueError(
                "Refusing to start in production with insecure defaults:\n  - "
                + "\n  - ".join(problems)
            )
        return self


settings = Settings()
