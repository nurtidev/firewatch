/**
 * Wave 1 domain dictionary — landing surfaces: "/", "/gov", "/business",
 * "/login" (body strings), plus the shared PIPELINE/MODULES content data
 * (components/landing/content.ts) rendered on those pages.
 *
 * Keys are exact Russian source strings. A missing key falls back to the
 * Russian string unchanged. Keys already covered by lib/i18n/common.ts
 * (nav labels, role labels, chrome strings — e.g. "Карта риска", "Для ДЧС",
 * "Инфраструктура") are intentionally NOT duplicated here.
 *
 * Kazakh is official-register Cyrillic: ДЧС → ТЖД (Төтенше жағдайлар
 * департаменті), МЧС РК → ҚР ТЖМ (Төтенше жағдайлар министрлігі),
 * пожарная безопасность → өрт қауіпсіздігі, здание → ғимарат, риск →
 * тәуекел, ПТП → ӨСЖ (Өртті сөндіру жоспары), оперкарточка → жедел
 * дерекнама, слепые зоны → «соқыр аймақтар», цифровой двойник → цифрлық
 * егіз, ЖК (жилой комплекс) → ТҮК (тұрғын үй кешені), УК → БК (басқарушы
 * компания), ПДн → ДД (дербес деректер).
 */
export const dict: { en: Record<string, string>; kk: Record<string, string> } = {
  en: {
    // ── "/" nav + header ──────────────────────────────────────────────────
    "Цифровой двойник": "Digital twin",
    "Платформа": "Platform",
    "Как работает": "How it works",
    "Запросить демо": "Request a demo",

    // ── "/" hero ──────────────────────────────────────────────────────────
    "Пилот": "Pilot",
    "Астана · предиктивная пожарная безопасность": "Astana · predictive fire safety",
    "Цифровой двойник объекта": "Digital twin of the facility",
    "и прогноз риска": "and risk forecast",
    "— до того, как загорится": "— before it catches fire",
    "FireWatch превращает бумажный план тушения в интерактивный 3D-двойник, оценивает риск каждого здания и объясняет почему — чтобы ДЧС действовал на опережение, а не постфактум.":
      "FireWatch turns a paper fire suppression plan into an interactive 3D twin, scores the risk of every building, and explains why — so the ESD can act ahead of an incident, not after it.",
    "Как это работает": "How it works",
    "оценка риска здания": "building risk score",
    "<10 мин": "<10 min",
    "норматив прибытия": "arrival standard",
    "объяснимая модель": "explainable model",
    "Реальная геометрия · 3D": "Real geometry · 3D",
    "Реальная геометрия типового этажа ЖК «Хайвилл-Астана» из оперативного плана тушения. Вращайте, кликайте по помещениям.":
      "Real geometry of a typical floor of the Hayvill-Astana residential complex, from its fire suppression plan. Rotate it, click on rooms.",

    // ── "/" trust strip ───────────────────────────────────────────────────
    "Данные пилота (Астана). Риск-оценки рассчитаны на синтетических признаках и не отражают реальное состояние объектов — до загрузки исторических данных ДЧС.":
      "Pilot data (Astana). Risk scores are computed on synthetic features and do not reflect the actual condition of facilities — until historical ESD data is loaded.",
    "Объяснимая модель (SHAP)": "Explainable model (SHAP)",
    "ИИ не выдумывает": "AI does not invent",
    "Журнал аудита (WORM)": "Audit log (WORM)",
    "Готово к размещению в РК": "Ready for hosting in Kazakhstan",

    // ── "/" audience fork ─────────────────────────────────────────────────
    "Два контура": "Two tracks",
    "Кому нужен FireWatch": "Who needs FireWatch",
    "Государству — платформа для города и региона. Бизнесу — цифровой паспорт объекта. Выберите свой контур.":
      "For government — a platform for the city and the region. For business — a digital facility passport. Choose your track.",
    "Государство": "Government",
    "Для ДЧС и акиматов": "For the ESD and akimats",
    "Ведомственная платформа предиктивной пожарной безопасности для города и региона.":
      "A departmental predictive fire-safety platform for the city and the region.",
    "Карта риска по всем зданиям города": "Risk map for every building in the city",
    "Журнал аудита, маскирование ПДн, размещение в РК": "Audit log, PII masking, hosting in Kazakhstan",
    "Пилот на реальных данных вашего региона": "A pilot on real data from your region",
    "Платформа для ДЧС": "Platform for the ESD",
    "Бизнес": "Business",
    "Для объектов бизнеса": "For business facilities",
    "Цифровой паспорт объекта для ТРЦ, ЖК, офисов и застройщиков — с ИИ и риск-картой.":
      "A digital facility passport for malls, residential complexes, offices and developers — with AI and a risk map.",
    "План эвакуации, документы ПБ и 2D/3D-планы": "Evacuation plan, fire-safety documents and 2D/3D plans",
    "ИИ-извлечение из документов за минуты": "AI extraction from documents in minutes",
    "Предиктивная риск-оценка объекта": "Predictive risk score for the facility",
    "Оцифровать объект": "Digitize a facility",

    // ── "/" twin (pipeline) section ───────────────────────────────────────
    "Оцифровка": "Digitization",
    "Из бумажного ПТП — в цифровой 3D-двойник": "From a paper fire plan to a digital 3D twin",
    "Планы тушения годами лежат в .vsd и сканах. Мы восстанавливаем из них реальную геометрию помещений — и она сразу становится интерактивной.":
      "Fire suppression plans sit for years in .vsd files and scans. We reconstruct the real geometry of the rooms from them — and it instantly becomes interactive.",
    "На примере поквартирной экспликации ЖК «Хайвилл-Астана». Полигоны калиброваны по площадям из ПТП — это оцифровка реального документа, а не иллюстрация.":
      "Shown on the apartment-by-apartment layout of the Hayvill-Astana residential complex. Polygons are calibrated to the areas from the fire plan — this is a digitization of a real document, not an illustration.",

    // ── "/" modules section ───────────────────────────────────────────────
    "Шесть модулей — один контур безопасности": "Six modules — one safety loop",
    "Каждый закрывает свою боль ведомства и работает с общими данными.":
      "Each one solves a specific pain point for the department and works on shared data.",

    // ── "/" how-it-works (STEPS) ──────────────────────────────────────────
    "От данных — к действию за три шага": "From data to action in three steps",
    "FireWatch собирает данные, прогнозирует риск и превращает прогноз в конкретные задачи для инспекторов.":
      "FireWatch collects data, forecasts risk, and turns the forecast into concrete tasks for inspectors.",
    "Сбор данных": "Data collection",
    "Здания из OSM и кадастра, история инцидентов за 3 года, гидранты, пожарные части. Оперкарточки распознаёт ИИ — строго из документа, без выдумок.":
      "Buildings from OSM and the cadastre, 3 years of incident history, hydrants, fire stations. AI recognizes response cards — strictly from the document, with no invention.",
    "Прогноз риска": "Risk forecast",
    "Модель XGBoost оценивает каждое здание по 30+ признакам: материал, возраст, этажность, инциденты рядом, сезон. SHAP объясняет каждую оценку.":
      "The XGBoost model scores every building on 30+ features: material, age, number of floors, nearby incidents, season. SHAP explains every score.",
    "Действие": "Action",
    "Утренний маршрут инспектора по приоритету риска, подсветка «слепых зон» прибытия, ответ ИИ-аналитика на запрос на естественном языке.":
      "The inspector's morning route prioritized by risk, highlighted arrival blind spots, and the AI analyst's answer to a natural-language query.",

    // ── "/" numbers strip (STATS) ─────────────────────────────────────────
    "зданий на карте риска": "buildings on the risk map",
    "гидрантов в модели покрытия": "hydrants in the coverage model",
    "объекта с оцифрованными ПТП": "facilities with digitized fire plans",
    "помещение в 3D-двойниках": "rooms in 3D twins",
    "планов этажей оцифровано": "floor plans digitized",

    // ── "/" final CTA + footer ────────────────────────────────────────────
    "Покажем FireWatch на данных вашего региона": "We'll show FireWatch on your region's data",
    "Демо за 30 минут: карта риска, прогноз модели, маршрут инспектора и 3D-двойник объекта на реальном городе.":
      "A 30-minute demo: risk map, model forecast, inspector route and a 3D facility twin on a real city.",
    "Без обязательств · 30 минут · на данных вашего региона": "No obligations · 30 minutes · on your region's data",
    "Предиктивная пожарная безопасность · МЧС РК · Астана": "Predictive fire safety · MES RK · Astana",

    // ── "/gov" nav ─────────────────────────────────────────────────────────
    "Безопасность": "Security",
    "Запросить пилот": "Request a pilot",

    // ── "/gov" hero ────────────────────────────────────────────────────────
    "МЧС РК": "MES RK",
    "Ведомственная платформа · пилот в Астане": "Departmental platform · pilot in Astana",
    "Прогноз пожарного риска": "Fire risk forecast",
    "для всего города": "for the whole city",
    "FireWatch оценивает риск каждого из ~250 000 зданий, объясняет каждую оценку и превращает прогноз в маршруты инспекций и карту «слепых зон» прибытия расчётов — чтобы ДЧС действовал на опережение.":
      "FireWatch scores the risk of each of ~250,000 buildings, explains every score, and turns the forecast into inspection routes and a map of response arrival blind spots — so the ESD can act ahead of an incident.",
    "Презентация платформы": "Platform presentation",
    "зданий города": "city buildings",
    "Стилизация карты риска на условных данных. Реальная карта строится на исторических данных пожаров вашего региона — каждое здание с оценкой 0–100.":
      "A stylized risk map on illustrative data. The real map is built on your region's historical fire data — every building with a 0–100 score.",

    // ── "/gov" problems ────────────────────────────────────────────────────
    "Задача ведомства": "Departmental challenge",
    "Надзор за городом — вручную не масштабируется": "City-wide oversight doesn't scale manually",
    "Объём объектов и разрозненные документы не дают увидеть риск целиком. FireWatch собирает эту картину в одном контуре.":
      "The sheer volume of facilities and scattered documents make it impossible to see the whole risk picture. FireWatch brings it together in one loop.",
    "250 000 зданий — вручную не приоритизировать": "250,000 buildings — impossible to prioritize by hand",
    "Инспекторов — сотни, объектов — сотни тысяч. Решать, кого проверять первым, по интуиции и жалобам — значит опаздывать.":
      "There are hundreds of inspectors and hundreds of thousands of facilities. Deciding who to check first by intuition and complaints means being late.",
    "Планы тушения — в бумаге и .vsd": "Fire suppression plans live on paper and in .vsd",
    "ПТП и оперкарточки годами лежат в сканах и файлах Visio. Подготовка карточки на объект занимает у инженера дни.":
      "Fire plans and response cards sit for years in scans and Visio files. Preparing a card for a facility takes an engineer days.",
    "Нет единой картины риска и «слепых зон»": "No unified picture of risk and blind spots",
    "Где расчёт не успевает за норматив прибытия и где скопился риск — вручную по всему городу не увидеть.":
      "Where response crews miss the arrival standard and where risk has accumulated — you cannot see it manually across the whole city.",

    // ── "/gov" stakes ──────────────────────────────────────────────────────
    "Цена вопроса": "The cost of the problem",
    "Сколько стоит год без приоритизации": "What a year without prioritization costs",
    "Официальная статистика — из выступлений должностных лиц МЧС РК и ДЧС Астаны.":
      "Official statistics — from statements by MES RK and Astana ESD officials.",
    "По нашему расчёту система окупается уже в консервативном сценарии.":
      "By our estimate, the system pays for itself even under a conservative scenario.",
    "Запросите детальное экономическое обоснование": "Request the detailed economic justification",
    "— с методикой, источниками и допущениями.": "— with methodology, sources and assumptions.",
    "1 из 36": "1 in 36",
    "пожаров в РК уносит жизнь — в США гибелью заканчивается 1 из 360":
      "of fires in Kazakhstan claim a life — in the US, only 1 in 360 does",
    "МЧС РК · 2021": "MES RK · 2021",
    "9,3 млрд ₸": "₸9.3 billion",
    "прямой материальный ущерб от пожаров за год; 413 погибших": "direct material damage from fires per year; 413 deaths",
    "МЧС РК · 2021–2025": "MES RK · 2021–2025",
    "пожаров происходит в жилом секторе; до половины причин устранимы профилактической проверкой":
      "of fires occur in the residential sector; up to half of the causes can be eliminated by a preventive inspection",
    "1,6": "1.6",
    "нарушения пожарной безопасности на каждый дом, обойденный в рейдах по частному сектору Астаны":
      "fire-safety violations per house visited during private-sector raids in Astana",
    "ДЧС Астаны · 2024": "Astana ESD · 2024",

    // ── "/gov" modules ─────────────────────────────────────────────────────
    "Шесть модулей — один контур надзора": "Six modules — one oversight loop",
    "Каждый модуль закрывает свою задачу ведомства и работает на общих данных ДЧС.":
      "Each module solves a specific task for the department and runs on shared ESD data.",

    // ── "/gov" pilot ───────────────────────────────────────────────────────
    "Как проходит пилот": "How the pilot runs",
    "3 месяца, 1 район Астаны. ДЧС получает рабочую систему на реальных данных района — и обоснованное решение о развёртывании на весь город.":
      "3 months, 1 district of Astana. The ESD gets a working system on the district's real data — and a well-founded decision on citywide rollout.",
    "Неделя 0": "Week 0",
    "LOI и передача данных": "LOI and data handover",
    "Подписание письма о намерениях, доступ к исторической статистике пожаров и реестру объектов района.":
      "Signing the letter of intent, access to the district's historical fire statistics and facility registry.",
    "Недели 1–2": "Weeks 1–2",
    "Карта риска района": "District risk map",
    "Загрузка данных и переобучение модели — карта риска на реальной статистике района, а не на демо.":
      "Data loading and model retraining — a risk map on the district's real statistics, not a demo.",
    "Недели 3–4": "Weeks 3–4",
    "Оцифровка объектов": "Facility digitization",
    "10–20 ключевых объектов района: ПТП и оперкарточки с 2D/3D-планами в системе.":
      "10–20 key facilities in the district: fire plans and response cards with 2D/3D plans in the system.",
    "Недели 5–12": "Weeks 5–12",
    "Эксплуатация и отчёт": "Operation and report",
    "Маршруты инспекций и чек-листы в работе, анализ «слепых зон» и отчёт об эффекте пилота.":
      "Inspection routes and checklists in operation, blind-spot analysis and a pilot effect report.",
    "Что нужно от ДЧС: письмо о намерениях (LOI), история пожаров района за 2–3 года и реестр объектов, 1–2 контактных инспектора. Оцифровка до 20 объектов — в рамках пилота.":
      "What's needed from the ESD: a letter of intent (LOI), 2–3 years of district fire history and the facility registry, 1–2 point-of-contact inspectors. Digitizing up to 20 facilities is included in the pilot.",

    // ── "/gov" trust ───────────────────────────────────────────────────────
    "Доверие и безопасность": "Trust and security",
    "Ведомственный контур — по умолчанию": "Departmental-grade by default",
    "FireWatch спроектирован под требования госзаказчика: аудируемость, защита персональных данных, объяснимость и работа в форматах МЧС РК.":
      "FireWatch is designed to meet government-customer requirements: auditability, personal-data protection, explainability, and compatibility with MES RK formats.",
    "Каждое действие пользователя фиксируется в неизменяемом журнале — записи нельзя изменить или удалить задним числом.":
      "Every user action is recorded in an immutable log — entries cannot be changed or deleted after the fact.",
    "Маскирование ПДн": "PII masking",
    "Персональные данные маскируются уже при извлечении из документов — в систему не попадает лишнее.":
      "Personal data is masked already at the document-extraction stage — nothing extra ever enters the system.",
    "Разворачивается на инфраструктуре заказчика в Казахстане — on-prem или облако РК; доступ разграничен по ролям и районам.":
      "Deploys on the customer's infrastructure in Kazakhstan — on-prem or a local cloud; access is scoped by role and district.",
    "Модель — не «чёрный ящик»: по каждой оценке виден вклад каждого фактора, решение можно обосновать.":
      "The model is not a \"black box\": for every score you can see each factor's contribution, and the decision can be justified.",
    "Работа по форме МЧС РК": "Works in MES RK formats",
    "Оцифровка оперкарточек по форме ОК-1 и планов тушения (ПТП/КТП) — в ведомственных форматах.":
      "Digitizing response cards in the OK-1 form and fire suppression plans (fire/tactical plans) — in departmental formats.",

    // ── "/gov" twin (brief) ───────────────────────────────────────────────
    "Бумажный ПТП — в интерактивный 3D": "A paper fire plan — turned into interactive 3D",
    "ИИ восстанавливает из сканов и .vsd реальную геометрию помещений: калиброванные полигоны с площадями в м², окрашенные по назначению. Тот же двойник — в оперкарточке объекта.":
      "AI reconstructs the real geometry of rooms from scans and .vsd files: calibrated polygons with areas in m², colored by purpose. The same twin appears in the facility's response card.",
    "Как устроена оцифровка": "How the digitization works",
    "Типовой этаж ЖК «Хайвилл-Астана» из оперативного плана тушения — реальный объект города, уже оцифрованный в системе.":
      "A typical floor of the Hayvill-Astana residential complex from its fire suppression plan — a real city facility already digitized in the system.",

    // ── "/gov" final CTA + footer ─────────────────────────────────────────
    "Покажем на данных вашего региона": "We'll show it on your region's data",
    "Пилот — 3 месяца на одном районе Астаны. Развернём систему на реальных данных района и покажем эффект в цифрах.":
      "The pilot is 3 months in a single district of Astana. We'll deploy the system on the district's real data and show the effect in numbers.",
    "Без обязательств · на реальных данных района · с обучением сотрудников":
      "No obligations · on the district's real data · with staff training",
    "Ведомственная платформа пожарной безопасности · МЧС РК": "Departmental fire-safety platform · MES RK",

    // ── "/business" nav ────────────────────────────────────────────────────
    "Паспорт объекта": "Facility passport",
    "Стоимость": "Pricing",
    "Обсудить оцифровку": "Discuss digitization",

    // ── "/business" hero ───────────────────────────────────────────────────
    "Цифровой паспорт объекта": "Digital facility passport",
    "— с ИИ и риск-картой": "— with AI and a risk map",
    "Обсудить оцифровку объекта": "Discuss digitizing the facility",
    "Что входит": "What's included",
    "от 150 000 ₸": "from ₸150,000",
    "за объект": "per facility",
    "планы объекта": "facility plans",
    "минуты": "minutes",
    "вместо дней ручной работы": "instead of days of manual work",
    "3D-двойник объекта": "3D twin of the facility",
    "Интерактивный 3D-двойник из планов объекта. Реальная геометрия ЖК «Хайвилл-Астана». Вращайте, кликайте по помещениям.":
      "An interactive 3D twin built from the facility's plans. Real geometry of the Hayvill-Astana residential complex. Rotate it, click on rooms.",

    // ── "/business" offer ──────────────────────────────────────────────────
    "Всё об объекте — в одном портале": "Everything about the facility — in one portal",
    "Цифровой паспорт собирает документы, планы и оценку риска в одном месте — вместо разрозненных файлов и папок.":
      "The digital passport brings documents, plans and the risk score together in one place — instead of scattered files and folders.",
    "План эвакуации и пакет документов по пожарной безопасности": "Evacuation plan and the fire-safety document package",
    "Независимый аудит ПБ — по запросу, через аккредитованную экспертную организацию":
      "Independent fire-safety audit — on request, via an accredited expert organization",
    "2D- и 3D-планы объекта — автогенерация из документов": "2D and 3D facility plans — auto-generated from documents",
    "Оперкарточки: ИИ извлекает поля из ваших документов": "Response cards: AI extracts fields from your documents",
    "Цифровой паспорт: планы, карточки и риск-оценка в одном портале":
      "Digital passport: plans, cards and the risk score in one portal",
    "Предиктивная риск-оценка объекта — которой нет ни у кого в РК":
      "A predictive facility risk score — unmatched anywhere in Kazakhstan",
    "Цифровой паспорт · план помещения": "Digital passport · room plan",
    "2D / 3D-планы": "2D / 3D plans",
    "Документы ПБ": "Fire-safety documents",
    "Риск-оценка": "Risk score",

    // ── "/business" pipeline ───────────────────────────────────────────────
    "Из документов — в цифровой 3D-двойник": "From documents to a digital 3D twin",
    "Планы и экспликации объекта превращаются в калиброванную геометрию — и сразу становятся интерактивными.":
      "The facility's plans and layouts turn into calibrated geometry — and become interactive right away.",
    "На примере поквартирной экспликации ЖК «Хайвилл-Астана». Полигоны калиброваны по реальным площадям — это оцифровка документа, а не иллюстрация.":
      "Shown on the apartment-by-apartment layout of the Hayvill-Astana residential complex. Polygons are calibrated to real areas — this is a digitization of the document, not an illustration.",

    // ── "/business" case: ЖК «Аланда» ──────────────────────────────────────
    "Кейс": "Case study",
    "Реальный кейс": "Real case",
    "ЖК «Аланда»: из бумажного ПТП — в цифровой двойник":
      "Alanda residential complex: from a paper fire plan to a digital twin",
    "Текстовые характеристики ПТП и 19 листов схем Visio — в структурную карточку объекта за считанные дни.":
      "The fire plan's text specifications and 19 Visio scheme sheets — into a structured facility card in a matter of days.",
    "До — бумажный ПТП": "Before — a paper fire plan",
    "Оцифровка ИИ": "AI digitization",
    "После — структурная карточка": "After — a structured card",
    "Схемы, характеристики и расчёт сил собираются в единую карточку объекта с 3D-двойником и риск-оценкой — доступна в системе.":
      "Schemes, specifications and the force calculation come together into one facility card with a 3D twin and a risk score — available in the system.",
    "Смотреть в системе": "View in the system",
    "Реальный объект пилота (Астана). Схемы оцифрованы из исходного Visio-ПТП ДЧС; персональные данные из документа в публичный кейс не выносятся.":
      "A real pilot facility (Astana). The schemes are digitized from the original ESD Visio fire plan; personal data from the document is not carried into the public case.",
    "Титул ПТП, 2021": "Fire plan cover, 2021",
    "Тактико-технические характеристики": "Tactical and technical specifications",
    "Скан титульного листа плана тушения пожара ЖК «Аланда»":
      "Scan of the cover sheet of the Alanda residential complex fire suppression plan",
    "Скан страницы плана тушения с таблицей тактико-технических характеристик здания":
      "Scan of a fire plan page with the building's tactical and technical specifications table",
    "Схемы объекта": "Facility schemes",
    "Генеральный план объекта": "Facility site plan",
    "Схема водоисточников": "Water sources scheme",
    "20 345 м²": "20,345 m²",
    "площадь по ТТС": "area per specifications",
    "этажа": "floors",
    "пожарных гидранта": "fire hydrants",
    "Ранг №3": "Rank No. 3",
    "расчёт сил — автоматически": "force calculation — automatic",

    // ── "/business" audience ───────────────────────────────────────────────
    "Для кого": "Who it's for",
    "Кому подходит цифровой паспорт": "Who the digital passport is for",
    "Любому объекту, где есть обязанность по пожарной безопасности и ценно видеть риск заранее.":
      "Any facility with a fire-safety obligation, where seeing the risk in advance matters.",
    "ТРЦ и ритейл": "Malls and retail",
    "Большие потоки людей и высокая пожарная нагрузка — паспорт и план эвакуации под контролем.":
      "Large crowds and high fire load — the passport and evacuation plan under control.",
    "ЖК и УК": "Residential complexes and management companies",
    "Управляющим компаниям — единый портал по всем корпусам, планы и риск-оценка в одном месте.":
      "For management companies — a single portal for all buildings, with plans and the risk score in one place.",
    "Офисы и бизнес-центры": "Offices and business centers",
    "Документы и планы эвакуации без недель ручной работы подрядчика.":
      "Documents and evacuation plans, without weeks of a contractor's manual work.",
    "Застройщики": "Developers",
    "Цифровой паспорт для сдачи и эксплуатации объекта — 2D/3D сразу из проектной документации.":
      "A digital passport for facility handover and operation — 2D/3D straight from the design documentation.",

    // ── "/business" risk facts ─────────────────────────────────────────────
    "Риск в цифрах": "Risk in numbers",
    "Почему это касается вашего объекта": "Why this concerns your facility",
    "Официальная статистика МЧС РК и ДЧС Астаны — без страшилок, просто цифры.":
      "Official statistics from MES RK and Astana ESD — no scare tactics, just numbers.",
    "пожаров начинаются с электрооборудования — проводка, щитки, перегруженные сети. Это вопрос эксплуатации, а не везения":
      "of fires start with electrical equipment — wiring, panels, overloaded circuits. It's a matter of maintenance, not luck",
    "МЧС РК · 2025": "MES RK · 2025",
    "рост пожаров в многоэтажных домах за год — нагрузка на УК и ЖК растёт":
      "rise in high-rise fires over the year — the load on management companies and residential complexes is growing",
    "МЧС РК · янв–май 2025": "MES RK · Jan–May 2025",
    "автомобилей сгорело в Астане за год — паркинг ТРЦ и ЖК — зона прямой ответственности владельца":
      "cars burned in Astana over the year — mall and residential-complex parking is the owner's direct responsibility",
    "ДЧС Астаны · 2025": "Astana ESD · 2025",
    "пожаров в РК заканчивается гибелью людей — для владельца это ответственность, а не только материальный ущерб":
      "of fires in Kazakhstan end in loss of life — for an owner that's a liability, not just material damage",
    "Цифровой паспорт закрывает первопричину: документы и планы объекта всегда актуальны, а риск-оценка показывает, какие объекты и системы требуют внимания в первую очередь.":
      "The digital passport addresses the root cause: the facility's documents and plans stay current, and the risk score shows which facilities and systems need attention first.",

    // ── "/business" pricing ────────────────────────────────────────────────
    "Прозрачные пакеты, а не «звоните — обсудим»": "Transparent packages, not \"call us to discuss\"",
    "Продаём не отдельный документ, а комплексный паспорт, где премию оправдывают скорость, 2D/3D и риск-карта.":
      "We sell not a single document, but a comprehensive passport, where the premium is justified by speed, 2D/3D and the risk map.",
    "Основной пакет": "Main package",
    "План эвакуации + 2D/3D-планы + риск-оценка + портал объекта.":
      "Evacuation plan + 2D/3D plans + risk score + facility portal.",
    "разово, за объект": "one-time, per facility",
    "Портфельный пакет": "Portfolio package",
    "То же, пакетом для девелопера или УК от 10 объектов.":
      "The same, as a package for a developer or management company with 10+ facilities.",
    "к цене за объект": "off the price per facility",
    "Подписка · мониторинг": "Subscription · monitoring",
    "Паспорт всегда актуален: обновление, портал, доступ инспектору и собственнику.":
      "The passport is always up to date: updates, portal, access for the inspector and the owner.",
    "от 30 000 ₸": "from ₸30,000",
    "в месяц за объект": "per month, per facility",
    "Цены — ориентир и финализируются по составу и объёму объекта. Расход на ИИ-извлечение — сотые доли процента стоимости; всё остальное — работа над качеством паспорта.":
      "Prices are indicative and are finalized based on the facility's scope and composition. The cost of AI extraction is a fraction of a percent of the total; the rest is work on the passport's quality.",

    // ── "/business" cross-link + final CTA + footer ──────────────────────
    "Работаете в госсекторе?": "Working in the public sector?",
    "Для ДЧС и акиматов — ведомственная платформа с картой риска по всему городу.":
      "For the ESD and akimats — a departmental platform with a citywide risk map.",
    "Оцифруем ваш объект": "We'll digitize your facility",
    "Пришлите планы и документы — соберём цифровой паспорт с 2D/3D и риск-оценкой. Обсудим объём и сроки под ваш объект.":
      "Send us the plans and documents — we'll assemble a digital passport with 2D/3D and a risk score. We'll discuss the scope and timeline for your facility.",
    "ИИ-извлечение · 2D/3D-планы · предиктивная риск-оценка объекта":
      "AI extraction · 2D/3D plans · predictive facility risk score",
    "Цифровой паспорт объекта · ТРЦ, ЖК, офисы, застройщики":
      "Digital facility passport · malls, residential complexes, offices, developers",

    // ── "/login" ───────────────────────────────────────────────────────────
    "Предиктивная платформа · МЧС РК": "Predictive platform · MES RK",
    "Логин": "Username",
    "Введите логин": "Enter username",
    "Пароль": "Password",
    "Введите пароль": "Enter password",
    "Ошибка входа": "Sign-in error",
    "Вход…": "Signing in…",
    "Быстрый вход для демонстрации": "Quick demo sign-in",
    "Защищённый доступ · только для сотрудников ДЧС": "Secure access · ESD staff only",
    "Замминистра": "Deputy minister",
    "руководство ведомства": "department leadership",
    "Руководитель": "Head of division",
    "управление надзора": "oversight division",
    "надзор на объектах": "on-site oversight",
    "Надзорная вертикаль": "Oversight chain",
    "Реагирование и внешние": "Response & external",
    "Диспетчер": "Dispatcher",
    "ЦОУ · 112": "OCC · 112",
    "боевые расчёты ПЧ": "fire station duty crews",
    "портал ОСИ": "HOA portal",
    "все модули": "all modules",

    // ── components/landing/content.ts — PIPELINE ──────────────────────────
    "Бумажный ПТП или .vsd": "A paper fire plan or .vsd",
    "Отсканированный план тушения, чертёж Visio или PDF-экспликация — исходник, который сегодня лежит в папке.":
      "A scanned fire suppression plan, a Visio drawing, or a PDF layout — the source document sitting in a folder today.",
    "Векторные полигоны": "Vector polygons",
    "Стены и помещения восстанавливаются в калиброванную геометрию: каждая комната — многоугольник с площадью в м².":
      "Walls and rooms are reconstructed into calibrated geometry: each room becomes a polygon with an area in m².",
    "Интерактивный 3D-двойник": "Interactive 3D twin",
    "Помещения окрашены по назначению, кликабельны, вращаются. Тот самый двойник — в шапке главной страницы.":
      "Rooms are colored by purpose, clickable, and rotate. That's the very twin shown in the homepage hero.",

    // ── components/landing/content.ts — MODULES ───────────────────────────
    "Где загорится вероятнее всего?": "Where is a fire most likely?",
    "Каждое здание окрашено по оценке 0–100. Фильтры, клик → карточка с историей и SHAP-объяснением.":
      "Every building is colored by its 0–100 score. Filters, click → a card with history and a SHAP explanation.",
    "Прогноз и объяснение": "Forecast and explanation",
    "Почему именно 87 из 100?": "Why exactly 87 out of 100?",
    "XGBoost + SHAP: виден вклад каждого фактора. Ежедневный пересчёт по всему городу.":
      "XGBoost + SHAP: every factor's contribution is visible. Daily recalculation across the whole city.",
    "Оперкарточки и ПТП": "Response cards and fire plans",
    "Час ручного ввода — в минуту": "An hour of manual entry — in a minute",
    "Скан ОК-1 / ПТП → ИИ извлекает поля и строит 2D/3D-план → автопредписания из нарушений.":
      "Scan of OK-1 / fire plan → AI extracts the fields and builds a 2D/3D plan → auto-generated orders from violations.",
    "Кого проверять сегодня?": "Who to inspect today?",
    "Маршрут на день по риску и сроку, мобильный чек-лист с фото, дашборд выполнения.":
      "A daily route by risk and deadline, a mobile checklist with photos, a completion dashboard.",
    "Куда не успеть за 10 минут?": "Where won't crews make it in 10 minutes?",
    "Гидранты, части, изохроны прибытия и автоподсветка «слепых зон» покрытия.":
      "Hydrants, stations, arrival isochrones and automatic highlighting of coverage blind spots.",
    "Ответ без ручных выгрузок": "Answers without manual exports",
    "Вопрос на естественном языке → ответ строго из данных ДЧС, с указанием источников.":
      "A natural-language question → an answer strictly from ESD data, with sources cited.",

    // ── landing de-slop pass: trimmed hero/strip/CTA copy ─────────────────
    "FireWatch превращает бумажный план тушения в интерактивный 3D-двойник и оценивает риск каждого здания — чтобы ДЧС действовал на опережение.":
      "FireWatch turns a paper fire suppression plan into an interactive 3D twin and scores the risk of every building — so the ESD can act ahead of an incident.",
    "Пилот в Астане · предиктивная пожарная безопасность": "Pilot in Astana · predictive fire safety",
    "Без обязательств · демо 30 минут на данных вашего региона":
      "No obligations · a 30-minute demo on your region's data",
    "FireWatch оценивает риск каждого из ~250 000 зданий и превращает прогноз в маршруты инспекций и карту «слепых зон» прибытия.":
      "FireWatch scores the risk of each of ~250,000 buildings and turns the forecast into inspection routes and a map of arrival blind spots.",
    "Без обязательств · на реальных данных района, с обучением сотрудников":
      "No obligations · on the district's real data, with staff training",
    "Не папка бумаг, а объект в портале: план эвакуации, 2D/3D-планы и риск-оценка, которой нет ни у кого.":
      "Not a folder of papers, but a facility in a portal: evacuation plan, 2D/3D plans and a risk score nobody else offers.",
    "Независимый аудит в области пожарной безопасности проводит аккредитованная экспертная организация-партнёр (аккредитация КЧС МВД РК, Закон РК «О гражданской защите»). FireWatch выполняет цифровую часть: планы, документы, паспорт объекта и риск-оценку.":
      "The independent fire-safety audit is performed by an accredited partner expert organization (accredited by the Emergency Situations Committee of the MIA RK under the Law 'On Civil Protection'). FireWatch delivers the digital part: plans, documents, the facility passport and the risk score.",
    "Для бизнеса · цифровой паспорт объекта": "For business · a digital facility passport",
    "пожаров начинаются с электрооборудования — проводка, щитки, перегруженные сети":
      "of fires start with electrical equipment — wiring, panels, overloaded circuits",
    "автомобилей сгорело в Астане за год — зона ответственности владельца":
      "cars burned in Astana over the year — the owner's zone of responsibility",
    "пожаров в РК заканчивается гибелью людей — это ответственность владельца":
      "of fires in Kazakhstan end in loss of life — that's the owner's liability",
    "ИИ-извлечение и 2D/3D-планы · предиктивная риск-оценка объекта":
      "AI extraction and 2D/3D plans · predictive facility risk score",

    // ── components/landing/chrome.tsx — ContactRow (secondary channels) ────
    "или:": "or:",
    "почта": "email",
    "Написать в WhatsApp": "Message on WhatsApp",
    "Написать в Telegram": "Message on Telegram",
    "Написать на почту": "Send an email",
  },
  kk: {
    // ── "/" nav + header ──────────────────────────────────────────────────
    "Цифровой двойник": "Цифрлық егіз",
    "Платформа": "Платформа",
    "Как работает": "Қалай жұмыс істейді",
    "Запросить демо": "Демо сұрау",

    // ── "/" hero ──────────────────────────────────────────────────────────
    "Пилот": "Пилот",
    "Астана · предиктивная пожарная безопасность": "Астана · болжамды өрт қауіпсіздігі",
    "Цифровой двойник объекта": "Нысанның цифрлық егізі",
    "и прогноз риска": "және тәуекел болжамы",
    "— до того, как загорится": "— өрт шықпай тұрып",
    "FireWatch превращает бумажный план тушения в интерактивный 3D-двойник, оценивает риск каждого здания и объясняет почему — чтобы ДЧС действовал на опережение, а не постфактум.":
      "FireWatch қағаз түріндегі өрт сөндіру жоспарын интерактивті 3D-егізге айналдырады, әрбір ғимараттың тәуекелін бағалайды және себебін түсіндіреді — ТЖД оқиғадан кейін емес, алдын ала әрекет етуі үшін.",
    "Как это работает": "Бұл қалай жұмыс істейді",
    "оценка риска здания": "ғимарат тәуекел бағасы",
    "<10 мин": "<10 мин",
    "норматив прибытия": "келу нормативі",
    "объяснимая модель": "түсіндірілетін модель",
    "Реальная геометрия · 3D": "Нақты геометрия · 3D",
    "Реальная геометрия типового этажа ЖК «Хайвилл-Астана» из оперативного плана тушения. Вращайте, кликайте по помещениям.":
      "«Хайвилл-Астана» ТҮК-нің типтік қабатының өрт сөндіру жоспарынан алынған нақты геометриясы. Айналдырыңыз, бөлмелерді басыңыз.",

    // ── "/" trust strip ───────────────────────────────────────────────────
    "Данные пилота (Астана). Риск-оценки рассчитаны на синтетических признаках и не отражают реальное состояние объектов — до загрузки исторических данных ДЧС.":
      "Пилоттық деректер (Астана). Тәуекел бағалары синтетикалық белгілер бойынша есептелген және ТЖД-ның тарихи деректері жүктелгенге дейін нысандардың нақты жай-күйін көрсетпейді.",
    "Объяснимая модель (SHAP)": "Түсіндірілетін модель (SHAP)",
    "ИИ не выдумывает": "ЖИ ойдан шығармайды",
    "Журнал аудита (WORM)": "Аудит журналы (WORM)",
    "Готово к размещению в РК": "ҚР аумағында орналастыруға дайын",

    // ── "/" audience fork ─────────────────────────────────────────────────
    "Два контура": "Екі бағыт",
    "Кому нужен FireWatch": "FireWatch кімге қажет",
    "Государству — платформа для города и региона. Бизнесу — цифровой паспорт объекта. Выберите свой контур.":
      "Мемлекетке — қала мен өңірге арналған платформа. Бизнеске — нысанның цифрлық паспорты. Өз бағытыңызды таңдаңыз.",
    "Государство": "Мемлекет",
    "Для ДЧС и акиматов": "ТЖД мен әкімдіктерге арналған",
    "Ведомственная платформа предиктивной пожарной безопасности для города и региона.":
      "Қала мен өңірге арналған болжамды өрт қауіпсіздігінің ведомстволық платформасы.",
    "Карта риска по всем зданиям города": "Қаланың барлық ғимараттары бойынша тәуекел картасы",
    "Журнал аудита, маскирование ПДн, размещение в РК": "Аудит журналы, ДД бүркемелеу, ҚР аумағында орналастыру",
    "Пилот на реальных данных вашего региона": "Өз өңіріңіздің нақты деректеріндегі пилот",
    "Платформа для ДЧС": "ТЖД-ға арналған платформа",
    "Бизнес": "Бизнес",
    "Для объектов бизнеса": "Бизнес нысандарына арналған",
    "Цифровой паспорт объекта для ТРЦ, ЖК, офисов и застройщиков — с ИИ и риск-картой.":
      "СОО, ТҮК, кеңселер мен құрылысшыларға арналған нысанның цифрлық паспорты — ЖИ мен тәуекел картасымен.",
    "План эвакуации, документы ПБ и 2D/3D-планы": "Эвакуация жоспары, ӨҚ құжаттары және 2D/3D жоспарлар",
    "ИИ-извлечение из документов за минуты": "Құжаттардан ЖИ көмегімен бірнеше минутта деректер алу",
    "Предиктивная риск-оценка объекта": "Нысанның болжамды тәуекел бағасы",
    "Оцифровать объект": "Нысанды цифрландыру",

    // ── "/" twin (pipeline) section ───────────────────────────────────────
    "Оцифровка": "Цифрландыру",
    "Из бумажного ПТП — в цифровой 3D-двойник": "Қағаз ӨСЖ-ден цифрлық 3D-егізге дейін",
    "Планы тушения годами лежат в .vsd и сканах. Мы восстанавливаем из них реальную геометрию помещений — и она сразу становится интерактивной.":
      "Өрт сөндіру жоспарлары жылдар бойы .vsd файлдары мен сканерленген құжаттарда жатады. Біз олардан бөлмелердің нақты геометриясын қалпына келтіреміз — және ол бірден интерактивті болады.",
    "На примере поквартирной экспликации ЖК «Хайвилл-Астана». Полигоны калиброваны по площадям из ПТП — это оцифровка реального документа, а не иллюстрация.":
      "«Хайвилл-Астана» ТҮК-нің пәтерлер экспликациясы мысалында. Полигондар ӨСЖ-дегі аудандар бойынша калибрленген — бұл нақты құжатты цифрландыру, иллюстрация емес.",

    // ── "/" modules section ───────────────────────────────────────────────
    "Шесть модулей — один контур безопасности": "Алты модуль — бір қауіпсіздік контуры",
    "Каждый закрывает свою боль ведомства и работает с общими данными.":
      "Әрқайсысы ведомствоның нақты мәселесін шешеді және ортақ деректермен жұмыс істейді.",

    // ── "/" how-it-works (STEPS) ──────────────────────────────────────────
    "От данных — к действию за три шага": "Деректен әрекетке — үш қадамда",
    "FireWatch собирает данные, прогнозирует риск и превращает прогноз в конкретные задачи для инспекторов.":
      "FireWatch деректерді жинайды, тәуекелді болжайды және болжамды инспекторларға арналған нақты тапсырмаларға айналдырады.",
    "Сбор данных": "Деректерді жинау",
    "Здания из OSM и кадастра, история инцидентов за 3 года, гидранты, пожарные части. Оперкарточки распознаёт ИИ — строго из документа, без выдумок.":
      "OSM және кадастрдан алынған ғимараттар, 3 жылдық оқиғалар тарихы, гидранттар, өрт сөндіру бөлімдері. Жедел дерекнамаларды ЖИ таниды — тек құжат негізінде, ойдан шығармай.",
    "Прогноз риска": "Тәуекел болжамы",
    "Модель XGBoost оценивает каждое здание по 30+ признакам: материал, возраст, этажность, инциденты рядом, сезон. SHAP объясняет каждую оценку.":
      "XGBoost моделі әрбір ғимаратты 30-дан астам белгі бойынша бағалайды: материал, жасы, қабаттылығы, жақын маңдағы оқиғалар, маусым. SHAP әрбір бағаны түсіндіреді.",
    "Действие": "Әрекет",
    "Утренний маршрут инспектора по приоритету риска, подсветка «слепых зон» прибытия, ответ ИИ-аналитика на запрос на естественном языке.":
      "Инспектордың таңғы бағыты тәуекел басымдығы бойынша, келудің «соқыр аймақтарын» бөлектеу, ЖИ-талдаушының табиғи тілдегі сұрауға жауабы.",

    // ── "/" numbers strip (STATS) ─────────────────────────────────────────
    "зданий на карте риска": "тәуекел картасындағы ғимарат",
    "гидрантов в модели покрытия": "қамту моделіндегі гидрант",
    "объекта с оцифрованными ПТП": "цифрландырылған ӨСЖ-і бар нысан",
    "помещение в 3D-двойниках": "3D-егіздердегі бөлме",
    "планов этажей оцифровано": "цифрландырылған қабат жоспары",

    // ── "/" final CTA + footer ────────────────────────────────────────────
    "Покажем FireWatch на данных вашего региона": "FireWatch-ты өз өңіріңіздің деректерінде көрсетеміз",
    "Демо за 30 минут: карта риска, прогноз модели, маршрут инспектора и 3D-двойник объекта на реальном городе.":
      "30 минуттық демо: тәуекел картасы, модель болжамы, инспектор бағыты және нақты қаладағы нысанның 3D-егізі.",
    "Без обязательств · 30 минут · на данных вашего региона": "Міндеттемесіз · 30 минут · өз өңіріңіздің деректерінде",
    "Предиктивная пожарная безопасность · МЧС РК · Астана": "Болжамды өрт қауіпсіздігі · ҚР ТЖМ · Астана",

    // ── "/gov" nav ─────────────────────────────────────────────────────────
    "Безопасность": "Қауіпсіздік",
    "Запросить пилот": "Пилот сұрау",

    // ── "/gov" hero ────────────────────────────────────────────────────────
    "МЧС РК": "ҚР ТЖМ",
    "Ведомственная платформа · пилот в Астане": "Ведомстволық платформа · Астанадағы пилот",
    "Прогноз пожарного риска": "Өрт тәуекелінің болжамы",
    "для всего города": "бүкіл қала үшін",
    "FireWatch оценивает риск каждого из ~250 000 зданий, объясняет каждую оценку и превращает прогноз в маршруты инспекций и карту «слепых зон» прибытия расчётов — чтобы ДЧС действовал на опережение.":
      "FireWatch шамамен 250 000 ғимараттың әрқайсысының тәуекелін бағалайды, әрбір бағаны түсіндіреді және болжамды тексеру бағыттары мен есептердің келу «соқыр аймақтары» картасына айналдырады — ТЖД алдын ала әрекет етуі үшін.",
    "Презентация платформы": "Платформа презентациясы",
    "зданий города": "қала ғимараттары",
    "Стилизация карты риска на условных данных. Реальная карта строится на исторических данных пожаров вашего региона — каждое здание с оценкой 0–100.":
      "Шартты деректердегі тәуекел картасының стилизациясы. Нақты карта өз өңіріңіздің өрт тарихы деректері негізінде құрылады — әрбір ғимарат 0–100 бағамен.",

    // ── "/gov" problems ────────────────────────────────────────────────────
    "Задача ведомства": "Ведомство міндеті",
    "Надзор за городом — вручную не масштабируется": "Қала бойынша қадағалау қолмен масштабталмайды",
    "Объём объектов и разрозненные документы не дают увидеть риск целиком. FireWatch собирает эту картину в одном контуре.":
      "Нысандар көлемі мен әртүрлі құжаттар тәуекелдің тұтас көрінісін көруге мүмкіндік бермейді. FireWatch бұл көріністі бір контурда жинайды.",
    "250 000 зданий — вручную не приоритизировать": "250 000 ғимарат — қолмен басымдық қоюға болмайды",
    "Инспекторов — сотни, объектов — сотни тысяч. Решать, кого проверять первым, по интуиции и жалобам — значит опаздывать.":
      "Инспекторлар — жүздеген, нысандар — жүздеген мың. Кімді бірінші тексеру керектігін интуиция мен шағымдар бойынша шешу — кешігу дегенді білдіреді.",
    "Планы тушения — в бумаге и .vsd": "Өрт сөндіру жоспарлары қағазда және .vsd файлдарында",
    "ПТП и оперкарточки годами лежат в сканах и файлах Visio. Подготовка карточки на объект занимает у инженера дни.":
      "ӨСЖ мен жедел дерекнамалар жылдар бойы сканерленген құжаттар мен Visio файлдарында жатады. Инженер үшін нысанға дерекнама дайындау бірнеше күнге созылады.",
    "Нет единой картины риска и «слепых зон»": "Тәуекел мен «соқыр аймақтардың» тұтас көрінісі жоқ",
    "Где расчёт не успевает за норматив прибытия и где скопился риск — вручную по всему городу не увидеть.":
      "Есептің келу нормативіне үлгермейтін және тәуекел жиналған жерлерді бүкіл қала бойынша қолмен көру мүмкін емес.",

    // ── "/gov" stakes ──────────────────────────────────────────────────────
    "Цена вопроса": "Мәселенің құны",
    "Сколько стоит год без приоритизации": "Басымдықсыз бір жыл қанша тұрады",
    "Официальная статистика — из выступлений должностных лиц МЧС РК и ДЧС Астаны.":
      "Ресми статистика — ҚР ТЖМ және Астана ТЖД лауазымды тұлғаларының баяндамаларынан.",
    "По нашему расчёту система окупается уже в консервативном сценарии.":
      "Біздің есебіміз бойынша жүйе тіпті консервативті сценарийде де өзін ақтайды.",
    "Запросите детальное экономическое обоснование": "Толық экономикалық негіздемені сұраңыз",
    "— с методикой, источниками и допущениями.": "— әдістемесімен, дереккөздерімен және болжамдарымен.",
    "1 из 36": "36-ның 1-і",
    "пожаров в РК уносит жизнь — в США гибелью заканчивается 1 из 360":
      "ҚР-дағы өрттің өмірге қауіп төндіретіні — АҚШ-та әр 360 өрттің 1-і ғана қаза келтіреді",
    "МЧС РК · 2021": "ҚР ТЖМ · 2021",
    "9,3 млрд ₸": "9,3 млрд ₸",
    "прямой материальный ущерб от пожаров за год; 413 погибших": "жылына өрттен тікелей материалдық зиян; 413 адам қаза тапты",
    "МЧС РК · 2021–2025": "ҚР ТЖМ · 2021–2025",
    "пожаров происходит в жилом секторе; до половины причин устранимы профилактической проверкой":
      "өрт тұрғын секторда орын алады; себептердің жартысына дейінгісін алдын алу тексерісімен жоюға болады",
    "1,6": "1,6",
    "нарушения пожарной безопасности на каждый дом, обойденный в рейдах по частному сектору Астаны":
      "Астананың жеке секторындағы рейдтерде аралап шыққан әрбір үйге келетін өрт қауіпсіздігі бұзушылығы",
    "ДЧС Астаны · 2024": "Астана ТЖД · 2024",

    // ── "/gov" modules ─────────────────────────────────────────────────────
    "Шесть модулей — один контур надзора": "Алты модуль — бір қадағалау контуры",
    "Каждый модуль закрывает свою задачу ведомства и работает на общих данных ДЧС.":
      "Әрбір модуль ведомствоның нақты міндетін шешеді және ортақ ТЖД деректерінде жұмыс істейді.",

    // ── "/gov" pilot ───────────────────────────────────────────────────────
    "Как проходит пилот": "Пилот қалай өтеді",
    "3 месяца, 1 район Астаны. ДЧС получает рабочую систему на реальных данных района — и обоснованное решение о развёртывании на весь город.":
      "3 ай, Астананың 1 ауданы. ТЖД аудан деректеріндегі жұмыс істейтін жүйені алады — және бүкіл қалаға енгізу туралы негізделген шешім қабылдайды.",
    "Неделя 0": "0-апта",
    "LOI и передача данных": "LOI және деректерді беру",
    "Подписание письма о намерениях, доступ к исторической статистике пожаров и реестру объектов района.":
      "Ниет хатына қол қою, ауданның тарихи өрт статистикасы мен нысандар тізіліміне қолжеткізу.",
    "Недели 1–2": "1–2-апталар",
    "Карта риска района": "Аудан тәуекел картасы",
    "Загрузка данных и переобучение модели — карта риска на реальной статистике района, а не на демо.":
      "Деректерді жүктеу және модельді қайта оқыту — демода емес, ауданның нақты статистикасындағы тәуекел картасы.",
    "Недели 3–4": "3–4-апталар",
    "Оцифровка объектов": "Нысандарды цифрландыру",
    "10–20 ключевых объектов района: ПТП и оперкарточки с 2D/3D-планами в системе.":
      "Ауданның 10–20 негізгі нысаны: жүйедегі ӨСЖ мен 2D/3D жоспарлары бар жедел дерекнамалар.",
    "Недели 5–12": "5–12-апталар",
    "Эксплуатация и отчёт": "Пайдалану және есеп",
    "Маршруты инспекций и чек-листы в работе, анализ «слепых зон» и отчёт об эффекте пилота.":
      "Тексеру бағыттары мен чек-парақтар жұмыста, «соқыр аймақтар» талдауы және пилот тиімділігі туралы есеп.",
    "Что нужно от ДЧС: письмо о намерениях (LOI), история пожаров района за 2–3 года и реестр объектов, 1–2 контактных инспектора. Оцифровка до 20 объектов — в рамках пилота.":
      "ТЖД-дан не қажет: ниет хаты (LOI), ауданның 2–3 жылдық өрт тарихы мен нысандар тізілімі, 1–2 байланыс инспекторы. 20 нысанға дейін цифрландыру — пилот аясында.",

    // ── "/gov" trust ───────────────────────────────────────────────────────
    "Доверие и безопасность": "Сенім мен қауіпсіздік",
    "Ведомственный контур — по умолчанию": "Әдепкі бойынша ведомстволық контур",
    "FireWatch спроектирован под требования госзаказчика: аудируемость, защита персональных данных, объяснимость и работа в форматах МЧС РК.":
      "FireWatch мемлекеттік тапсырыс беруші талаптарына сай жобаланған: аудитке жарамдылық, дербес деректерді қорғау, түсіндірілуі және ҚР ТЖМ форматтарында жұмыс істеу.",
    "Каждое действие пользователя фиксируется в неизменяемом журнале — записи нельзя изменить или удалить задним числом.":
      "Пайдаланушының әрбір әрекеті өзгермейтін журналда тіркеледі — жазбаларды кейін өзгертуге немесе жоюға болмайды.",
    "Маскирование ПДн": "ДД бүркемелеу",
    "Персональные данные маскируются уже при извлечении из документов — в систему не попадает лишнее.":
      "Дербес деректер құжаттардан алынған кезден бастап-ақ маскировкаланады — жүйеге артық ештеңе түспейді.",
    "Разворачивается на инфраструктуре заказчика в Казахстане — on-prem или облако РК; доступ разграничен по ролям и районам.":
      "Тапсырыс берушінің Қазақстандағы инфрақұрылымында орналастырылады — on-prem немесе ҚР бұлты; қолжеткізу рөлдер мен аудандар бойынша шектелген.",
    "Модель — не «чёрный ящик»: по каждой оценке виден вклад каждого фактора, решение можно обосновать.":
      "Модель «қара жәшік» емес: әрбір баға бойынша әрбір фактордың үлесі көрінеді, шешімді негіздеуге болады.",
    "Работа по форме МЧС РК": "ҚР ТЖМ нысаны бойынша жұмыс",
    "Оцифровка оперкарточек по форме ОК-1 и планов тушения (ПТП/КТП) — в ведомственных форматах.":
      "ОК-1 нысаны бойынша жедел дерекнамаларды және өрт сөндіру жоспарларын (ӨСЖ/ТӨСЖ) ведомстволық форматтарда цифрландыру.",

    // ── "/gov" twin (brief) ───────────────────────────────────────────────
    "Бумажный ПТП — в интерактивный 3D": "Қағаз ӨСЖ — интерактивті 3D-ге айналады",
    "ИИ восстанавливает из сканов и .vsd реальную геометрию помещений: калиброванные полигоны с площадями в м², окрашенные по назначению. Тот же двойник — в оперкарточке объекта.":
      "ЖИ сканерленген құжаттар мен .vsd файлдарынан бөлмелердің нақты геометриясын қалпына келтіреді: м²-мен өлшенген, мақсатына қарай боялған калибрленген полигондар. Дәл сол егіз — нысанның жедел дерекнамасында да бар.",
    "Как устроена оцифровка": "Цифрландыру қалай жүзеге асады",
    "Типовой этаж ЖК «Хайвилл-Астана» из оперативного плана тушения — реальный объект города, уже оцифрованный в системе.":
      "«Хайвилл-Астана» ТҮК-нің өрт сөндіру жоспарынан алынған типтік қабаты — жүйеде цифрландырылған қаланың нақты нысаны.",

    // ── "/gov" final CTA + footer ─────────────────────────────────────────
    "Покажем на данных вашего региона": "Өз өңіріңіздің деректерінде көрсетеміз",
    "Пилот — 3 месяца на одном районе Астаны. Развернём систему на реальных данных района и покажем эффект в цифрах.":
      "Пилот — Астананың бір ауданында 3 ай. Жүйені аудан деректерінде іске қосамыз және тиімділікті цифрларда көрсетеміз.",
    "Без обязательств · на реальных данных района · с обучением сотрудников":
      "Міндеттемесіз · аудан деректерінде · қызметкерлерді оқытумен",
    "Ведомственная платформа пожарной безопасности · МЧС РК": "Өрт қауіпсіздігінің ведомстволық платформасы · ҚР ТЖМ",

    // ── "/business" nav ────────────────────────────────────────────────────
    "Паспорт объекта": "Нысан паспорты",
    "Стоимость": "Құны",
    "Обсудить оцифровку": "Цифрландыруды талқылау",

    // ── "/business" hero ───────────────────────────────────────────────────
    "Цифровой паспорт объекта": "Нысанның цифрлық паспорты",
    "— с ИИ и риск-картой": "— ЖИ мен тәуекел картасымен",
    "Обсудить оцифровку объекта": "Нысанды цифрландыруды талқылау",
    "Что входит": "Не кіреді",
    "от 150 000 ₸": "150 000 ₸-ден",
    "за объект": "нысан үшін",
    "планы объекта": "нысан жоспарлары",
    "минуты": "минуттар",
    "вместо дней ручной работы": "қолмен жасалатын күндер орнына",
    "3D-двойник объекта": "Нысанның 3D-егізі",
    "Интерактивный 3D-двойник из планов объекта. Реальная геометрия ЖК «Хайвилл-Астана». Вращайте, кликайте по помещениям.":
      "Нысан жоспарларынан жасалған интерактивті 3D-егіз. «Хайвилл-Астана» ТҮК-нің нақты геометриясы. Айналдырыңыз, бөлмелерді басыңыз.",

    // ── "/business" offer ──────────────────────────────────────────────────
    "Всё об объекте — в одном портале": "Нысан туралы барлығы — бір порталда",
    "Цифровой паспорт собирает документы, планы и оценку риска в одном месте — вместо разрозненных файлов и папок.":
      "Цифрлық паспорт құжаттарды, жоспарларды және тәуекел бағасын шашыраңқы файлдар мен папкалардың орнына бір жерге жинайды.",
    "План эвакуации и пакет документов по пожарной безопасности": "Эвакуация жоспары және өрт қауіпсіздігі құжаттар пакеті",
    "Независимый аудит ПБ — по запросу, через аккредитованную экспертную организацию":
      "Тәуелсіз ӨҚ аудиті — сұраныс бойынша, аккредиттелген сараптама ұйымы арқылы",
    "2D- и 3D-планы объекта — автогенерация из документов": "Нысанның 2D және 3D жоспарлары — құжаттардан автоматты жасалады",
    "Оперкарточки: ИИ извлекает поля из ваших документов": "Жедел дерекнамалар: ЖИ құжаттарыңыздан өрістерді алады",
    "Цифровой паспорт: планы, карточки и риск-оценка в одном портале":
      "Цифрлық паспорт: жоспарлар, дерекнамалар және тәуекел бағасы бір порталда",
    "Предиктивная риск-оценка объекта — которой нет ни у кого в РК":
      "ҚР-да ешкімде жоқ нысанның болжамды тәуекел бағасы",
    "Цифровой паспорт · план помещения": "Цифрлық паспорт · бөлме жоспары",
    "2D / 3D-планы": "2D / 3D жоспарлар",
    "Документы ПБ": "ӨҚ құжаттары",
    "Риск-оценка": "Тәуекел бағасы",

    // ── "/business" pipeline ───────────────────────────────────────────────
    "Из документов — в цифровой 3D-двойник": "Құжаттардан цифрлық 3D-егізге дейін",
    "Планы и экспликации объекта превращаются в калиброванную геометрию — и сразу становятся интерактивными.":
      "Нысанның жоспарлары мен экспликациясы калибрленген геометрияға айналады — және бірден интерактивті болады.",
    "На примере поквартирной экспликации ЖК «Хайвилл-Астана». Полигоны калиброваны по реальным площадям — это оцифровка документа, а не иллюстрация.":
      "«Хайвилл-Астана» ТҮК-нің пәтерлер экспликациясы мысалында. Полигондар нақты аудандар бойынша калибрленген — бұл құжатты цифрландыру, иллюстрация емес.",

    // ── "/business" case: ЖК «Аланда» ──────────────────────────────────────
    "Кейс": "Кейс",
    "Реальный кейс": "Нақты кейс",
    "ЖК «Аланда»: из бумажного ПТП — в цифровой двойник":
      "«Аланда» ТҮК: қағаз ӨСЖ-ден цифрлық егізге дейін",
    "Текстовые характеристики ПТП и 19 листов схем Visio — в структурную карточку объекта за считанные дни.":
      "ӨСЖ-нің мәтіндік сипаттамалары мен 19 парақ Visio сызбасы — бірнеше күнде нысанның құрылымдық дерекнамасына айналады.",
    "До — бумажный ПТП": "Дейін — қағаз ӨСЖ",
    "Оцифровка ИИ": "ЖИ-мен цифрландыру",
    "После — структурная карточка": "Кейін — құрылымдық дерекнама",
    "Схемы, характеристики и расчёт сил собираются в единую карточку объекта с 3D-двойником и риск-оценкой — доступна в системе.":
      "Сызбалар, сипаттамалар мен күштер есебі 3D-егізі және тәуекел бағасы бар бірыңғай нысан дерекнамасына жинақталады — жүйеде қолжетімді.",
    "Смотреть в системе": "Жүйеде қарау",
    "Реальный объект пилота (Астана). Схемы оцифрованы из исходного Visio-ПТП ДЧС; персональные данные из документа в публичный кейс не выносятся.":
      "Пилоттың нақты нысаны (Астана). Сызбалар ТЖД-ның бастапқы Visio-ӨСЖ-інен цифрланған; құжаттағы дербес деректер жария кейске шығарылмайды.",
    "Титул ПТП, 2021": "ӨСЖ титулы, 2021",
    "Тактико-технические характеристики": "Тактикалық-техникалық сипаттамалар",
    "Скан титульного листа плана тушения пожара ЖК «Аланда»":
      "«Аланда» ТҮК өрт сөндіру жоспарының титул парағының сканы",
    "Скан страницы плана тушения с таблицей тактико-технических характеристик здания":
      "Ғимараттың тактикалық-техникалық сипаттамалары кестесі бар өрт сөндіру жоспары бетінің сканы",
    "Схемы объекта": "Нысан сызбалары",
    "Генеральный план объекта": "Нысанның бас жоспары",
    "Схема водоисточников": "Су көздерінің сызбасы",
    "20 345 м²": "20 345 м²",
    "площадь по ТТС": "ТТС бойынша ауданы",
    "этажа": "қабат",
    "пожарных гидранта": "өрт гидранты",
    "Ранг №3": "№3 дәреже",
    "расчёт сил — автоматически": "күштер есебі — автоматты түрде",

    // ── "/business" audience ───────────────────────────────────────────────
    "Для кого": "Кімге арналған",
    "Кому подходит цифровой паспорт": "Цифрлық паспорт кімге жарайды",
    "Любому объекту, где есть обязанность по пожарной безопасности и ценно видеть риск заранее.":
      "Өрт қауіпсіздігі бойынша міндеттемесі бар және тәуекелді алдын ала көру маңызды кез келген нысанға.",
    "ТРЦ и ритейл": "СОО және сауда желілері",
    "Большие потоки людей и высокая пожарная нагрузка — паспорт и план эвакуации под контролем.":
      "Үлкен адам ағыны мен жоғары өрт жүктемесі — паспорт пен эвакуация жоспары бақылауда.",
    "ЖК и УК": "ТҮК және БК",
    "Управляющим компаниям — единый портал по всем корпусам, планы и риск-оценка в одном месте.":
      "Басқарушы компанияларға — барлық корпустар бойынша бір портал, жоспарлар мен тәуекел бағасы бір жерде.",
    "Офисы и бизнес-центры": "Кеңселер мен бизнес-орталықтар",
    "Документы и планы эвакуации без недель ручной работы подрядчика.":
      "Құжаттар мен эвакуация жоспарлары — мердігердің апталап қолмен жұмыс жасауынсыз.",
    "Застройщики": "Құрылысшылар",
    "Цифровой паспорт для сдачи и эксплуатации объекта — 2D/3D сразу из проектной документации.":
      "Нысанды тапсыру мен пайдалануға арналған цифрлық паспорт — жобалық құжаттамадан бірден алынған 2D/3D.",

    // ── "/business" risk facts ─────────────────────────────────────────────
    "Риск в цифрах": "Сандардағы тәуекел",
    "Почему это касается вашего объекта": "Бұл неге сіздің нысаныңызға қатысты",
    "Официальная статистика МЧС РК и ДЧС Астаны — без страшилок, просто цифры.":
      "ҚР ТЖМ және Астана ТЖД ресми статистикасы — қорқыныш әңгімелерсіз, жай ғана сандар.",
    "пожаров начинаются с электрооборудования — проводка, щитки, перегруженные сети. Это вопрос эксплуатации, а не везения":
      "өрт электр жабдығынан басталады — сымдар, щиттер, шамадан тыс жүктелген желілер. Бұл сәттіліктің емес, пайдаланудың мәселесі",
    "МЧС РК · 2025": "ҚР ТЖМ · 2025",
    "рост пожаров в многоэтажных домах за год — нагрузка на УК и ЖК растёт":
      "көпқабатты үйлердегі өрттің жыл ішіндегі өсуі — БК мен ТҮК-ге түсетін жүктеме артып келеді",
    "МЧС РК · янв–май 2025": "ҚР ТЖМ · 2025 қаңтар–мамыр",
    "автомобилей сгорело в Астане за год — паркинг ТРЦ и ЖК — зона прямой ответственности владельца":
      "Астанада жыл ішінде көлік өртенді — СОО мен ТҮК тұрағы иесінің тікелей жауапкершілік аймағы",
    "ДЧС Астаны · 2025": "Астана ТЖД · 2025",
    "пожаров в РК заканчивается гибелью людей — для владельца это ответственность, а не только материальный ущерб":
      "ҚР-дағы өрт адам қазасымен аяқталады — иесі үшін бұл тек материалдық зиян емес, жауапкершілік те",
    "Цифровой паспорт закрывает первопричину: документы и планы объекта всегда актуальны, а риск-оценка показывает, какие объекты и системы требуют внимания в первую очередь.":
      "Цифрлық паспорт түпкі себепті жояды: нысанның құжаттары мен жоспарлары әрдайым өзекті, ал тәуекел бағасы қай нысандар мен жүйелерге бірінші кезекте назар аудару керектігін көрсетеді.",

    // ── "/business" pricing ────────────────────────────────────────────────
    "Прозрачные пакеты, а не «звоните — обсудим»": "«Қоңырау шалыңыз — талқылаймыз» емес, ашық пакеттер",
    "Продаём не отдельный документ, а комплексный паспорт, где премию оправдывают скорость, 2D/3D и риск-карта.":
      "Біз жеке құжат емес, жылдамдық, 2D/3D және тәуекел картасымен ақталатын кешенді паспортты сатамыз.",
    "Основной пакет": "Негізгі пакет",
    "План эвакуации + 2D/3D-планы + риск-оценка + портал объекта.":
      "Эвакуация жоспары + 2D/3D жоспарлар + тәуекел бағасы + нысан порталы.",
    "разово, за объект": "бір реттік, нысан үшін",
    "Портфельный пакет": "Портфельдік пакет",
    "То же, пакетом для девелопера или УК от 10 объектов.":
      "Дәл сол, 10-нан астам нысаны бар құрылысшы немесе БК үшін пакет түрінде.",
    "к цене за объект": "нысан бағасынан",
    "Подписка · мониторинг": "Жазылым · мониторинг",
    "Паспорт всегда актуален: обновление, портал, доступ инспектору и собственнику.":
      "Паспорт әрқашан өзекті: жаңарту, портал, инспектор мен меншік иесіне қолжеткізу.",
    "от 30 000 ₸": "30 000 ₸-ден",
    "в месяц за объект": "айына, нысан үшін",
    "Цены — ориентир и финализируются по составу и объёму объекта. Расход на ИИ-извлечение — сотые доли процента стоимости; всё остальное — работа над качеством паспорта.":
      "Бағалар бағдарлама сипатында және нысанның құрамы мен көлеміне қарай нақтыланады. ЖИ көмегімен деректерді алуға кететін шығын құнның пайыздың жүзден бір бөлігін ғана құрайды; қалғаны — паспорт сапасына жұмсалатын еңбек.",

    // ── "/business" cross-link + final CTA + footer ──────────────────────
    "Работаете в госсекторе?": "Мемлекеттік секторда жұмыс істейсіз бе?",
    "Для ДЧС и акиматов — ведомственная платформа с картой риска по всему городу.":
      "ТЖД мен әкімдіктерге — бүкіл қала бойынша тәуекел картасы бар ведомстволық платформа.",
    "Оцифруем ваш объект": "Нысаныңызды цифрландырамыз",
    "Пришлите планы и документы — соберём цифровой паспорт с 2D/3D и риск-оценкой. Обсудим объём и сроки под ваш объект.":
      "Жоспарлар мен құжаттарды жіберіңіз — 2D/3D және тәуекел бағасы бар цифрлық паспортты құрастырамыз. Нысаныңызға арналған көлем мен мерзімдерді талқылаймыз.",
    "ИИ-извлечение · 2D/3D-планы · предиктивная риск-оценка объекта":
      "ЖИ көмегімен алу · 2D/3D жоспарлар · нысанның болжамды тәуекел бағасы",
    "Цифровой паспорт объекта · ТРЦ, ЖК, офисы, застройщики":
      "Нысанның цифрлық паспорты · СОО, ТҮК, кеңселер, құрылысшылар",

    // ── "/login" ───────────────────────────────────────────────────────────
    "Предиктивная платформа · МЧС РК": "Болжамды платформа · ҚР ТЖМ",
    "Логин": "Логин",
    "Введите логин": "Логинді енгізіңіз",
    "Пароль": "Құпия сөз",
    "Введите пароль": "Құпия сөзді енгізіңіз",
    "Ошибка входа": "Кіру қатесі",
    "Вход…": "Кіру…",
    "Быстрый вход для демонстрации": "Демо үшін жылдам кіру",
    "Защищённый доступ · только для сотрудников ДЧС": "Қорғалған қолжетімділік · тек ТЖД қызметкерлеріне арналған",
    "Замминистра": "Вице-министр",
    "руководство ведомства": "ведомство басшылығы",
    "Руководитель": "Басшы",
    "управление надзора": "қадағалау басқармасы",
    "надзор на объектах": "нысандарда қадағалау",
    "Надзорная вертикаль": "Қадағалау тізбегі",
    "Реагирование и внешние": "Ден қою және сыртқы",
    "Диспетчер": "Диспетчер",
    "ЦОУ · 112": "ЖБО · 112",
    "боевые расчёты ПЧ": "ӨСБ кезекші құрамы",
    "портал ОСИ": "МИБ порталы",
    "все модули": "барлық модульдер",

    // ── components/landing/content.ts — PIPELINE ──────────────────────────
    "Бумажный ПТП или .vsd": "Қағаз ӨСЖ немесе .vsd",
    "Отсканированный план тушения, чертёж Visio или PDF-экспликация — исходник, который сегодня лежит в папке.":
      "Сканерленген өрт сөндіру жоспары, Visio сызбасы немесе PDF экспликациясы — бүгін папкада жатқан бастапқы құжат.",
    "Векторные полигоны": "Векторлық полигондар",
    "Стены и помещения восстанавливаются в калиброванную геометрию: каждая комната — многоугольник с площадью в м².":
      "Қабырғалар мен бөлмелер калибрленген геометрияға қалпына келтіріледі: әрбір бөлме — м²-мен өлшенген көпбұрыш.",
    "Интерактивный 3D-двойник": "Интерактивті 3D-егіз",
    "Помещения окрашены по назначению, кликабельны, вращаются. Тот самый двойник — в шапке главной страницы.":
      "Бөлмелер мақсатына қарай боялған, басуға болады, айналады. Дәл осы егіз — басты беттің жоғарғы бөлігінде.",

    // ── components/landing/content.ts — MODULES ───────────────────────────
    "Где загорится вероятнее всего?": "Ең ықтимал өрт қай жерде шығады?",
    "Каждое здание окрашено по оценке 0–100. Фильтры, клик → карточка с историей и SHAP-объяснением.":
      "Әрбір ғимарат 0–100 бағасы бойынша боялған. Сүзгілер, басу → тарихы мен SHAP түсіндірмесі бар карточка.",
    "Прогноз и объяснение": "Болжам және түсіндірме",
    "Почему именно 87 из 100?": "Неге дәл 87/100?",
    "XGBoost + SHAP: виден вклад каждого фактора. Ежедневный пересчёт по всему городу.":
      "XGBoost + SHAP: әрбір фактордың үлесі көрінеді. Бүкіл қала бойынша күнделікті қайта есептеу.",
    "Оперкарточки и ПТП": "Жедел дерекнамалар мен ӨСЖ",
    "Час ручного ввода — в минуту": "Бір сағаттық қолмен енгізу — бір минутта",
    "Скан ОК-1 / ПТП → ИИ извлекает поля и строит 2D/3D-план → автопредписания из нарушений.":
      "ОК-1 / ӨСЖ сканы → ЖИ өрістерді алады және 2D/3D жоспар құрады → бұзушылықтардан автоматты нұсқама шығады.",
    "Кого проверять сегодня?": "Бүгін кімді тексеру керек?",
    "Маршрут на день по риску и сроку, мобильный чек-лист с фото, дашборд выполнения.":
      "Тәуекел мен мерзім бойынша күндізгі бағыт, фотосуреттері бар мобильді чек-парақ, орындау дашборды.",
    "Куда не успеть за 10 минут?": "10 минутта қай жерге үлгермейді?",
    "Гидранты, части, изохроны прибытия и автоподсветка «слепых зон» покрытия.":
      "Гидранттар, бөлімдер, келу изохроналары және қамтудың «соқыр аймақтарын» автоматты бөлектеу.",
    "Ответ без ручных выгрузок": "Қолмен түсірместен жауап",
    "Вопрос на естественном языке → ответ строго из данных ДЧС, с указанием источников.":
      "Табиғи тілдегі сұрақ → тек ТЖД деректері негізінде, дереккөздері көрсетілген жауап.",

    // ── landing de-slop pass: trimmed hero/strip/CTA copy ─────────────────
    "FireWatch превращает бумажный план тушения в интерактивный 3D-двойник и оценивает риск каждого здания — чтобы ДЧС действовал на опережение.":
      "FireWatch қағаз түріндегі өрт сөндіру жоспарын интерактивті 3D-егізге айналдырады және әрбір ғимараттың тәуекелін бағалайды — ТЖД алдын ала әрекет етуі үшін.",
    "Пилот в Астане · предиктивная пожарная безопасность": "Астанадағы пилот · болжамды өрт қауіпсіздігі",
    "Без обязательств · демо 30 минут на данных вашего региона":
      "Міндеттемесіз · өз өңіріңіздің деректеріндегі 30 минуттық демо",
    "FireWatch оценивает риск каждого из ~250 000 зданий и превращает прогноз в маршруты инспекций и карту «слепых зон» прибытия.":
      "FireWatch шамамен 250 000 ғимараттың әрқайсысының тәуекелін бағалайды және болжамды тексеру бағыттары мен келудің «соқыр аймақтары» картасына айналдырады.",
    "Без обязательств · на реальных данных района, с обучением сотрудников":
      "Міндеттемесіз · аудан деректерінде, қызметкерлерді оқытумен",
    "Не папка бумаг, а объект в портале: план эвакуации, 2D/3D-планы и риск-оценка, которой нет ни у кого.":
      "Қағаз папка емес, порталдағы нысан: эвакуация жоспары, 2D/3D жоспарлар және ешкімде жоқ тәуекел бағасы.",
    "Независимый аудит в области пожарной безопасности проводит аккредитованная экспертная организация-партнёр (аккредитация КЧС МВД РК, Закон РК «О гражданской защите»). FireWatch выполняет цифровую часть: планы, документы, паспорт объекта и риск-оценку.":
      "Тәуелсіз өрт қауіпсіздігі аудитін аккредиттелген серіктес сараптама ұйымы жүргізеді (ҚР ІІМ ТЖК аккредитациясы, ҚР «Азаматтық қорғау туралы» Заңы). FireWatch цифрлық бөлігін орындайды: жоспарлар, құжаттар, нысан паспорты және тәуекел бағасы.",
    "Для бизнеса · цифровой паспорт объекта": "Бизнеске · нысанның цифрлық паспорты",
    "пожаров начинаются с электрооборудования — проводка, щитки, перегруженные сети":
      "өрт электр жабдығынан басталады — сымдар, щиттер, шамадан тыс жүктелген желілер",
    "автомобилей сгорело в Астане за год — зона ответственности владельца":
      "Астанада жыл ішінде көлік өртенді — иесінің жауапкершілік аймағы",
    "пожаров в РК заканчивается гибелью людей — это ответственность владельца":
      "ҚР-дағы өрт адам қазасымен аяқталады — бұл иесінің жауапкершілігі",
    "ИИ-извлечение и 2D/3D-планы · предиктивная риск-оценка объекта":
      "ЖИ көмегімен алу және 2D/3D жоспарлар · нысанның болжамды тәуекел бағасы",

    // ── components/landing/chrome.tsx — ContactRow (secondary channels) ────
    "или:": "немесе:",
    "почта": "пошта",
    "Написать в WhatsApp": "WhatsApp-қа жазу",
    "Написать в Telegram": "Telegram-ға жазу",
    "Написать на почту": "Поштаға жазу",
  },
};
