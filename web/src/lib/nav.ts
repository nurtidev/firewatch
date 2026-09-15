import type { Role } from "./auth";

export type NavItem = {
  href: string;
  label: string;
  roles: Role[];
  /** Leading track this item belongs to in the sidebar — "Пожарные" (fire:
   *  ДЧС operational staff) vs "Город" (city: akimat & leadership). System/
   *  admin screens use "system" and sit in their own always-visible group at
   *  the bottom, unaffected by the track switch. Items with no track (e.g.
   *  /portal) render outside both tracks. */
  track?: "fire" | "city" | "system";
  /** Sub-heading inside the fire track only — "Реагирование" (day-to-day
   *  response ops) vs "Профилактика" (inspections/prevention). */
  section?: "response" | "prevention";
  /** Optional plain-language expansion, shown as a tooltip on hover — so
   *  domain jargon in the label never reads as an unexplained abbreviation. */
  hint?: string;
  /** Roles that the backend lets open this route (GET-access), but that
   *  should NOT see it as a sidebar destination — e.g. dispatcher/responder
   *  reach /cards or /forces only via a link inside the callout pack, never
   *  as a primary nav item. Kept out of `roles` (which also drives
   *  `navForRole`) and merged in only for AppShell's access check. */
  extraAccessRoles?: Role[];
};

// Order = sidebar order within each track/section group (see `track`/`section`
// above — AppShell groups items by track for rendering, it does not render
// this array flat). Each module is visible only to the listed roles.
export const NAV: NavItem[] = [
  { href: "/portal", label: "Мой объект", roles: ["owner"] },

  // ── Пожарные · Реагирование ──────────────────────────────────────────
  { href: "/dispatch", label: "Пульт ЦОУ", roles: ["dispatcher", "admin"],
    track: "fire", section: "response",
    hint: "Регистрация боевого выезда и боевой пакет караулу" },
  { href: "/callout", label: "Боевой выезд", roles: ["responder", "dispatcher", "admin"],
    track: "fire", section: "response",
    hint: "Оперативный пакет по выезду: ПТП, гидранты, препятствия проезда",
    // supervisor/leadership не заводят и не ведут выезды (нет в roles — не
    // засоряем им сайдбар пунктом «Боевой выезд»), но им открыт бэкенд
    // VIEW_ROLES на чтение пакета/донесения по закрытому выезду — deep link
    // «Пакет» из /callout/archive должен пройти guard AppShell, не 403.
    extraAccessRoles: ["supervisor", "leadership"] },
  // Архив закрытых выездов и печатных донесений — то же чтение, что у
  // /callout (VIEW_ROLES на бэкенде), но отдельный пункт меню: «Боевой
  // выезд» — рабочий экран по активным вызовам, архив — разбор задним числом.
  // Название «Донесения о пожарах» (не «Донесения» — этот ярлык занят
  // модулем полевых донесений /reports, категории препятствий пожаротушению).
  { href: "/callout/archive", label: "Донесения о пожарах",
    roles: ["dispatcher", "responder", "supervisor", "leadership", "admin"],
    track: "fire", section: "response",
    hint: "Закрытые выезды и печатные донесения о пожарах" },
  { href: "/cards", label: "Оперкарточки", roles: ["inspector", "supervisor", "admin"],
    track: "fire", section: "response",
    hint: "Оперативные карточки пожаротушения (ПТП) — распознавание скана в структурированные поля",
    extraAccessRoles: ["dispatcher", "responder"] },
  { href: "/forces", label: "Расчёт сил и средств", roles: ["supervisor", "admin"],
    track: "fire", section: "response",
    hint: "Калькулятор сил и средств на тушение по методике расчёта",
    extraAccessRoles: ["dispatcher", "responder"] },
  { href: "/vehicles", label: "Силы и техника", roles: ["responder", "dispatcher", "supervisor", "leadership", "admin"],
    track: "fire", section: "response",
    hint: "Состояние машин по частям и сводка выездов: чем расчёт сил обеспечен фактически" },

  // ── Пожарные · Профилактика ──────────────────────────────────────────
  { href: "/routes", label: "План инспекций", roles: ["inspector", "supervisor", "admin"],
    track: "fire", section: "prevention" },
  { href: "/control", label: "Контроль выполнения", roles: ["supervisor", "admin"],
    track: "fire", section: "prevention" },
  { href: "/reports", label: "Донесения", roles: ["inspector", "supervisor", "leadership", "admin", "dispatcher", "responder"],
    track: "fire", section: "prevention",
    hint: "Полевые донесения: заблокированные проезды, неисправные гидранты — вне плановых проверок" },
  // Раньше жили в треке «Город» (Phase 1): это ДЧС-внутренняя сводка,
  // карта риска и инфраструктура, а не картина города для акимата — Phase 2
  // развёл их по разным трекам. /dashboard — рабочий экран, который
  // leadership по-прежнему должен ВИДЕТЬ в сайдбаре (roles), а не доставать
  // только по deep link: сводка риска по городу остаётся его инструментом
  // ДЧС наравне с /city — картиной для акимата. /map и /infra — детальные
  // операционные экраны (карта конкретных зданий, состояние гидрантов) —
  // для leadership это уже не основная навигация, только extraAccessRoles
  // (deep link работает, из сайдбара не показывается).
  { href: "/dashboard", label: "Сводка ДЧС", roles: ["supervisor", "admin", "leadership"],
    track: "fire", section: "prevention" },
  { href: "/map", label: "Карта риска", roles: ["inspector", "supervisor", "admin"],
    track: "fire", section: "prevention",
    extraAccessRoles: ["leadership"] },
  { href: "/infra", label: "Инфраструктура", roles: ["supervisor", "admin"],
    track: "fire", section: "prevention",
    hint: "Гидранты, пожарные части, зоны прибытия и «слепые зоны» покрытия",
    extraAccessRoles: ["leadership"] },

  // ── Город ─────────────────────────────────────────────────────────────
  { href: "/city", label: "Обзор города", roles: ["akimat", "leadership", "admin"],
    track: "city",
    hint: "Пожарная уязвимость города по районам — сводка для акимата" },
  { href: "/city/map", label: "Карта уязвимости", roles: ["akimat", "leadership", "admin"],
    track: "city",
    hint: "Здания, зоны прибытия и гидранты на карте — районный срез" },
  { href: "/city/priorities", label: "Приоритеты вложений", roles: ["akimat", "leadership", "admin"],
    track: "city",
    hint: "Куда в первую очередь добавить гидранты и пожарные части" },
  { href: "/city/report", label: "Отчёт для акимата", roles: ["akimat", "leadership", "admin"],
    track: "city",
    hint: "Печатная сводка: КПЭ города, районы, приоритеты вложений" },
  // Аналитик исполняет свободные SELECT по всем районам — доступен только
  // командным ролям ДЧС (см. api/app/chat.py::ask); akimat туда не входит —
  // ему открыт только предметный, заранее посчитанный слой /city/*.
  { href: "/chat", label: "ИИ-аналитик", roles: ["leadership", "admin"],
    track: "city",
    hint: "Вопрос на естественном языке → ответ строго из данных ДЧС, с источниками" },

  // ── Система ───────────────────────────────────────────────────────────
  { href: "/model", label: "Модель ИИ", roles: ["leadership", "supervisor", "admin"],
    track: "system",
    hint: "Качество риск-модели: метрики и объяснимость (какие факторы влияют на оценку)" },
  { href: "/audit", label: "Журнал аудита", roles: ["leadership", "admin"],
    track: "system" },
  // Приём/отключение сотрудников и сброс паролей — привилегированная операция,
  // строго admin (см. require_roles("admin") в api/app/routers/auth.py).
  { href: "/users", label: "Пользователи", roles: ["admin"],
    track: "system",
    hint: "Учётные записи сотрудников: приём, отключение доступа, смена пароля" },
];

export const DEFAULT_ROUTE: Record<Role, string> = {
  inspector: "/routes",
  supervisor: "/dashboard",
  // Руководство теперь садится в трек «Город» — их рабочий экран это картина
  // города. /dashboard («Сводка ДЧС») остаётся в roles (сайдбар, не только
  // deep link) — см. TRACK_LANDING ниже для того, куда leadership попадает
  // при переключении обратно в трек «Пожарные».
  leadership: "/city",
  admin: "/dashboard",
  owner: "/portal",
  dispatcher: "/dispatch",
  responder: "/callout",
  akimat: "/city",
};

export const ROLE_LABEL: Record<Role, string> = {
  inspector: "Инспектор",
  supervisor: "Руководитель управления",
  leadership: "Руководство ведомства",
  admin: "Администратор",
  owner: "Владелец объекта",
  dispatcher: "Диспетчер ЦОУ",
  responder: "Начальник караула",
  akimat: "Акимат",
};

/** Metadata for the two leading tracks, driving the sidebar's track switch.
 *  `icon` is a name, not a component — nav.ts stays free of lucide-react
 *  imports, same as the ICONS map already kept in AppShell. */
export const TRACKS: Record<
  "fire" | "city",
  { label: string; hint: string; icon: "flame" | "landmark" }
> = {
  fire: {
    label: "Пожарные",
    hint: "ДЧС: реагирование и профилактика",
    icon: "flame",
  },
  city: {
    label: "Город",
    hint: "Акимат и руководство: картина города",
    icon: "landmark",
  },
};

/** Sub-headings for the fire track's two sections. */
export const SECTION_LABEL: Record<"response" | "prevention", string> = {
  response: "Реагирование",
  prevention: "Профилактика",
};

/** Heading for the always-visible admin/system group at the bottom of the nav. */
export const SYSTEM_GROUP_LABEL = "Система";

/** All nav items visible to a role, regardless of track — used by the
 *  dashboard's module tiles and by `trackItems`/grouping helpers below. */
export function navForRole(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}

/** Items visible to a role within a single track ("system" included). */
export function trackItems(
  role: Role,
  track: "fire" | "city" | "system",
): NavItem[] {
  return navForRole(role).filter((n) => n.track === track);
}

/** The single NAV item a pathname resolves to, or null outside NAV entirely.
 *  With `/city` and `/city/map` both registered, a naive "does pathname match
 *  this href" test matches BOTH for `/city/map` (it equals `/city/map` AND
 *  starts with `/city/`) — picking the LONGEST matching href is what makes
 *  exactly one item win. This is the one place that decision is made; the
 *  active-link highlight in AppShell, `trackOfPath` below, and AppShell's
 *  role-access guard all call this instead of re-deriving their own match. */
export function matchNavItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const n of NAV) {
    if (pathname === n.href || pathname.startsWith(n.href + "/")) {
      if (!best || n.href.length > best.href.length) best = n;
    }
  }
  return best;
}

/** Which track a given pathname belongs to, or null for untracked/non-nav
 *  routes (e.g. /portal, /login, or a page outside NAV entirely). */
export function trackOfPath(pathname: string): "fire" | "city" | "system" | null {
  return matchNavItem(pathname)?.track ?? null;
}

/** True only when a role has at least two visible items in BOTH the fire
 *  and the city track — that's when switching between them is meaningful.
 *  Matrix: leadership/admin → true (leadership has /dashboard, /vehicles,
 *  /reports, /callout/archive in fire — /map, /infra and /callout itself
 *  stay extraAccessRoles-only for it);
 *  supervisor → false (fire only, no city items); akimat → false (city
 *  only, no fire items); inspector/dispatcher/responder/owner → false. */
export function hasTrackSwitch(role: Role): boolean {
  return trackItems(role, "fire").length >= 2 && trackItems(role, "city").length >= 2;
}

/** Preferred landing hrefs per track, in priority order — used only when the
 *  role's DEFAULT_ROUTE isn't itself in that track (see trackLandingHref).
 *  Without this, switching to a track landed on `trackItems(role, track)[0]`
 *  — the first NAV entry in ARRAY order, which is an accident of how NAV
 *  happens to be listed, not a considered "this is where you land" choice:
 *  leadership switching to "fire" landed on /vehicles (first fire item that
 *  lists leadership in `roles`) instead of its actual fire-track home,
 *  /dashboard. */
const TRACK_LANDING: Record<"fire" | "city", string[]> = {
  fire: ["/dashboard", "/dispatch", "/callout", "/routes"],
  city: ["/city"],
};

/** Where a role should land when switching into `track` — the first
 *  TRACK_LANDING href that role can actually see in that track, falling back
 *  to the first visible item in NAV order if none of the preferences apply
 *  (e.g. a future role with none of the preferred hrefs). */
export function trackLandingHref(role: Role, track: "fire" | "city"): string | undefined {
  const visible = trackItems(role, track);
  for (const href of TRACK_LANDING[track]) {
    if (visible.some((n) => n.href === href)) return href;
  }
  return visible[0]?.href;
}
