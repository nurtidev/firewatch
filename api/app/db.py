"""Соединения с Postgres: пул запросов, отдельный пул аудита, сессия на запрос.

Почему устроено именно так (инцидент со смоук-теста /city, «QueuePool limit of
size 5 overflow 10 reached» и вход, висящий по 30 с):

  • Сессия запроса подключается как `Depends(get_db, scope="function")` — во
    ВСЕХ роутерах одинаково (tests/test_db_pool.py это проверяет). С FastAPI
    0.118+ зависимость с yield по умолчанию закрывается ПОСЛЕ отправки ответа:
    соединение оставалось «idle in transaction», пока тело ответа (мегабайты
    GeoJSON) уходило клиенту, а сквозь audit-middleware — пока ответ не
    вычитает middleware. Со `scope="function"` сессия закрывается сразу после
    того, как обработчик вернул и сериализовал результат. Разные scope у
    одного get_db в одном запросе дали бы ДВЕ сессии (scope входит в ключ
    кэша зависимостей) — поэтому scope везде один.
  • `end_read` — проверка токена (current_user) возвращает соединение в пул
    сразу после своего SELECT, а не держит его до конца запроса: ответ из
    кэша (app/cache.py) не занимает соединение вовсе, а ожидающий кэша запрос
    не держит соединение, пока ждёт.
  • Аудит пишет через свой маленький пул `audit_engine`. Раньше audit() брал
    ВТОРОЕ соединение из общего пула, пока обработчик (вход, карточка здания)
    держал первое: при занятом пуле это ожидание «держу одно, жду второе» —
    классическая взаимная блокировка до pool_timeout.
"""

from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

APPLICATION_NAME = "firewatch-api"


def _make_engine(application_name: str, *, pool_size: int, max_overflow: int,
                 pool_timeout: float):
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_timeout=pool_timeout,
        pool_recycle=settings.db_pool_recycle_sec,
        future=True,
        # connect_timeout keeps /health from hanging if the DB is unreachable;
        # application_name makes each pool visible in pg_stat_activity.
        connect_args={"connect_timeout": 5, "application_name": application_name},
    )


engine = _make_engine(
    APPLICATION_NAME,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout_sec,
)

# Аудит — отдельная полоса: запись о входе или отказе не должна ждать, пока
# тяжёлые запросы карты освободят общий пул, и не должна брать второе
# соединение из пула, где обработчик уже держит первое. Соединения постоянные
# (без overflow: соединение сверх pool_size закрывается после каждой записи, и
# при вале отказов аудит тратил время на установку соединений). Короткий
# таймаут: audit() best-effort и сам логирует сбой.
audit_engine = _make_engine(
    f"{APPLICATION_NAME}-audit",
    pool_size=max(1, settings.db_audit_pool_max),
    max_overflow=0,
    pool_timeout=5,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Сессия на запрос. Подключать только как `Depends(get_db, scope="function")`."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def end_read(db: Session) -> None:
    """Завершить читающую транзакцию и вернуть соединение в пул.

    Сессия остаётся рабочей: следующий `execute` возьмёт соединение заново.
    Звать только там, где в сессии нет незафиксированных изменений (после
    чистого SELECT) — откат их бы потерял.
    """
    db.rollback()


def heavy_read(db: Session) -> None:
    """Настройки транзакции для тяжёлого запроса чтения: без JIT и с потолком времени.

    `SET LOCAL` живёт до конца транзакции сессии, сессия закрывается в get_db
    (откат), так что настройки не утекают в пул.

    JIT: оценки стоимости PostGIS для geography (ST_DWithin) завышены на
    порядки, и планировщик включает JIT-компиляцию для запросов, которые сами
    исполняются за десятки-сотни миллисекунд: на демо-базе компиляция занимала
    250–360 мс из 380–580 мс запроса /city/summary.

    statement_timeout: при перегруженной базе запрос отменяется (ответ 503),
    а не держит соединение, пока за ним выстраивается очередь.
    """
    db.execute(text("SET LOCAL jit = off"))
    db.execute(
        text(f"SET LOCAL statement_timeout = {int(settings.db_heavy_statement_timeout_ms)}")
    )
