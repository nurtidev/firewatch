"""Демо-донесения (field reports) по районам Астаны.

Донесения раньше существовали только как след живой работы персон, поэтому
любая пересборка базы оставляла экран «Донесения» пустым, а сценарий
супервайзера «разобрать поток с мест» — непроверяемым. Здесь они засеяны явно.

Идемпотентно: записи опознаются по client_id с фиксированным префиксом, повтор
прогона обновляет их на месте и не плодит дублей. Пользовательские донесения
(без нашего префикса) скрипт не трогает.

Запуск: docker compose exec api python -m scripts.seed_field_reports
"""

from sqlalchemy import text

from app.db import engine

_PREFIX = "seed-fr-"

# (район, категория, статус, дни назад, описание)
# Формулировки — в духе реальной практики ГПК: то, что инспектор или караул
# фиксирует с места, а не абстрактные «нарушение №1».
REPORTS = [
    (
        "Сарыаркинский", "parking_barrier", "open", 1,
        "Пожарный проезд у торца дома занят личным транспортом жильцов, "
        "проезд для автолестницы перекрыт полностью.",
    ),
    (
        "Сарыаркинский", "blocked_exit", "in_progress", 3,
        "Эвакуационный выход из подъезда №2 заставлен строительными "
        "материалами после ремонта, дверь открывается наполовину.",
    ),
    (
        "Сарыаркинский", "hydrant_defect", "resolved", 9,
        "Гидрант у детской площадки не даёт напор, колодец затоплен. "
        "Передано в водоканал, по факту устранения напор восстановлен.",
    ),
    (
        "Есильский", "blocked_access", "open", 2,
        "Внутриквартальный проезд перекрыт ограждением стройплощадки, "
        "объезд только через соседний двор — плюс около четырёх минут.",
    ),
    (
        "Есильский", "parking_barrier", "in_progress", 5,
        "У въезда во двор установлен самовольный шлагбаум без ключа "
        "у диспетчера, круглосуточного дежурного нет.",
    ),
    (
        "Есильский", "ptp_mismatch", "open", 4,
        "Планировка цокольного этажа не совпадает с ПТП: вместо кладовых "
        "оборудован спортзал, второй выход заложен кирпичом.",
    ),
    (
        "Алматинский", "hydrant_defect", "open", 2,
        "Указатель пожарного гидранта отсутствует, крышка колодца под "
        "слоем щебня — в тёмное время найти без ориентира невозможно.",
    ),
    (
        "Алматинский", "blocked_access", "resolved", 12,
        "Проезд между домами сужен установкой мусорных контейнеров. "
        "После обращения контейнеры перенесены к торцу здания.",
    ),
    (
        "Нуринский", "other", "open", 6,
        "У выезда со двора складированы горючие отходы от ремонта, "
        "рядом газовые баллоны частной мастерской.",
    ),
    (
        "Нуринский", "blocked_exit", "dismissed", 15,
        "Сообщение о заваленном выходе не подтвердилось: проход свободен, "
        "материалы убраны до прибытия инспектора.",
    ),
    (
        "Байконырский", "parking_barrier", "open", 1,
        "Антипарковочные полусферы установлены поперёк пожарного проезда "
        "силами ОСИ, согласование не предъявлено.",
    ),
    (
        "Байконырский", "ptp_mismatch", "in_progress", 7,
        "Фактическое расположение узла управления спринклерной системы "
        "не совпадает с планом: перенесён в соседнее помещение.",
    ),
]


def main() -> None:
    created = updated = 0
    with engine.begin() as conn:
        for i, (district, category, status, days_ago, description) in enumerate(REPORTS):
            bid = conn.execute(
                text(
                    "SELECT id FROM buildings WHERE district = :d "
                    "ORDER BY id OFFSET :o LIMIT 1"
                ),
                {"d": district, "o": i * 37},
            ).scalar()
            if not bid:
                print(f"skip: в районе {district} нет зданий")
                continue

            client_id = f"{_PREFIX}{i:03d}"
            existing = conn.execute(
                text("SELECT id FROM field_reports WHERE client_id = :c"),
                {"c": client_id},
            ).scalar()

            # Точка донесения — центроид здания: донесение подаётся с места,
            # где инспектор физически стоит.
            params = {
                "b": bid,
                "cat": category,
                "st": status,
                "descr": description,
                "d": district,
                "days": days_ago,
                "c": client_id,
            }
            if existing:
                conn.execute(
                    text(
                        "UPDATE field_reports SET building_id = :b, category = :cat, "
                        "status = :st, description = :descr, district = :d, "
                        "geom = (SELECT ST_Centroid(geom) FROM buildings WHERE id = :b), "
                        "created_at = now() - make_interval(days => :days) "
                        "WHERE client_id = :c"
                    ),
                    params,
                )
                updated += 1
            else:
                conn.execute(
                    text(
                        "INSERT INTO field_reports "
                        "(building_id, category, status, description, district, geom, "
                        " created_by, created_role, client_id, created_at) "
                        "VALUES (:b, :cat, :st, :descr, :d, "
                        "        (SELECT ST_Centroid(geom) FROM buildings WHERE id = :b), "
                        "        'inspector', 'inspector', :c, "
                        "        now() - make_interval(days => :days))"
                    ),
                    params,
                )
                created += 1

    print(f"field reports seeded: {created} created, {updated} updated")


if __name__ == "__main__":
    main()
