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
    anthropic_model: str = "claude-sonnet-5"
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

    # Телематика: система мониторинга техники ДЧС. Позиции машин берутся из
    # СУЩЕСТВУЮЩЕЙ системы (на технике уже стоят трекеры) — своего трекинга мы
    # не заводим и к трекерам напрямую не подключаемся: это конфликт с
    # работающей системой. Пустой provider = интеграция не настроена, экраны
    # честно показывают «нет данных», а не выдумывают позиции.
    #   FW_TELEMATICS_PROVIDER=wialon|none
    #   FW_TELEMATICS_URL=https://hst-api.wialon.com
    #   FW_TELEMATICS_TOKEN=<токен доступа, выдаёт владелец системы>
    telematics_provider: str = Field(
        "none",
        validation_alias=AliasChoices("FW_TELEMATICS_PROVIDER", "TELEMATICS_PROVIDER"),
    )
    telematics_url: str = Field(
        "", validation_alias=AliasChoices("FW_TELEMATICS_URL", "TELEMATICS_URL")
    )
    telematics_token: str = Field(
        "", validation_alias=AliasChoices("FW_TELEMATICS_TOKEN", "TELEMATICS_TOKEN")
    )
    # Позиция старше этого возраста считается протухшей: показывать её на
    # боевом экране опаснее, чем не показывать ничего.
    telematics_stale_sec: int = Field(
        180, validation_alias=AliasChoices("FW_TELEMATICS_STALE_SEC", "TELEMATICS_STALE_SEC")
    )

    # Дорожная маршрутизация (OSRM). Пока URL пуст, зоны прибытия считаются
    # прямолинейным буфером и честно помечаются `approximate: true` — река
    # Есиль, железная дорога и закрытые кварталы в них не учтены. С поднятым
    # роутером те же ручки отдают настоящую достижимость по дорогам.
    #   FW_ROUTING_URL=http://osrm:5000
    routing_url: str = Field(
        "", validation_alias=AliasChoices("FW_ROUTING_URL", "ROUTING_URL")
    )
    # Шаг сетки для изохроны, метры. Мельче — точнее контур и дороже расчёт:
    # число точек растёт квадратично, а матрица OSRM линейна по точкам.
    routing_grid_step_m: int = Field(
        400, validation_alias=AliasChoices("FW_ROUTING_GRID_STEP_M", "ROUTING_GRID_STEP_M")
    )
    # Поправка на реальную дорожную обстановку. OSRM считает по свободному
    # потоку: ни заторов, ни гололёда, ни разъезда во дворе. Для карты это
    # значит, что зона прибытия «по дорогам» — верхняя оценка, как и круг,
    # только менее грубая. Множитель > 1 растягивает расчётное время хода и
    # сжимает зону до правдоподобной.
    #
    # Значение по умолчанию 1.0 намеренно: подставлять сюда придуманный
    # коэффициент значит выдавать догадку за расчёт. Калибруется по своим же
    # данным — `GET /infra/routing/calibration` сравнивает фактические времена
    # прибытия из закрытых выездов с расчётными и предлагает число.
    routing_time_factor: float = Field(
        1.0, validation_alias=AliasChoices("FW_ROUTING_TIME_FACTOR", "ROUTING_TIME_FACTOR")
    )

    # --- Соединения с Postgres (app/db.py) ------------------------------------
    # Один процесс uvicorn держит не больше db_pool_size + db_max_overflow
    # соединений запросов и db_audit_pool_max соединений аудита. Сумма по всем
    # процессам (api × воркеры, ml, cron, preDeploy-сиды, ручной psql) обязана
    # помещаться в `SHOW max_connections` базы с запасом — у стандартного образа
    # Postgres, в том числе на Railway, это 100.
    db_pool_size: int = Field(5, validation_alias=AliasChoices("FW_DB_POOL_SIZE", "DB_POOL_SIZE"))
    db_max_overflow: int = Field(
        10, validation_alias=AliasChoices("FW_DB_MAX_OVERFLOW", "DB_MAX_OVERFLOW")
    )
    # Сколько запрос ждёт свободное соединение, прежде чем получить 503. Раньше
    # действовали 30 с по умолчанию SQLAlchemy: при занятом пуле вход «висел»
    # полминуты, а не отвечал «перегрузка, повторите».
    db_pool_timeout_sec: float = Field(
        10.0, validation_alias=AliasChoices("FW_DB_POOL_TIMEOUT_SEC", "DB_POOL_TIMEOUT_SEC")
    )
    db_pool_recycle_sec: int = Field(
        1800, validation_alias=AliasChoices("FW_DB_POOL_RECYCLE_SEC", "DB_POOL_RECYCLE_SEC")
    )
    db_audit_pool_max: int = Field(
        3, validation_alias=AliasChoices("FW_DB_AUDIT_POOL_MAX", "DB_AUDIT_POOL_MAX")
    )
    # Потолок одного тяжёлого запроса чтения (/city/*, зоны прибытия и слепые
    # зоны, реестр зданий по bbox): медленная база должна отвечать ошибкой, а не
    # копить запросы, пока не займут весь пул.
    #
    # Держать МЕНЬШЕ db_pool_timeout_sec (в мс): держатель соединения — тот, кто
    # застрял в тяжёлом запросе, — обязан получить QueryCanceled от Postgres и
    # освободить соединение раньше, чем ожидающий это же соединение запрос
    # получит 503 по истечении пула. Иначе ожидающий отваливается первым, а
    # соединение всё ещё занято тем, кого только предстоит отменить: 503 уходит
    # раньше, чем перегрузка на самом деле снята. 8000 мс — с запасом ниже
    # 10-секундного db_pool_timeout_sec; оба значения настраиваются независимо
    # через переменные окружения, но при правке проверять именно это
    # неравенство (heavy < pool_timeout), а не подгонять их порознь.
    db_heavy_statement_timeout_ms: int = Field(
        8000,
        validation_alias=AliasChoices(
            "FW_DB_HEAVY_STATEMENT_TIMEOUT_MS", "DB_HEAVY_STATEMENT_TIMEOUT_MS"
        ),
    )
    # Кэш тяжёлых агрегатов чтения в памяти процесса (app/cache.py), секунды.
    # 0 — выключен (так в тестах: там данные меняются между запросами).
    read_cache_ttl_sec: float = Field(
        60.0, validation_alias=AliasChoices("FW_READ_CACHE_TTL_SEC", "READ_CACHE_TTL_SEC")
    )

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
