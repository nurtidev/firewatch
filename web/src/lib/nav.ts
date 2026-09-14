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
    hint: "Оперативный пакет по выезду: ПТП, гидранты, препятствия проезда" },
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

  // ── Город ─────────────────────────────────────────────────────────────
  { href: "/dashboard", label: "Дашборд", roles: ["supervisor", "leadership", "admin"],
    track: "city" },
  { href: "/map", label: "Карта риска", roles: ["inspector", "supervisor", "leadership", "admin"],
    track: "city" },
  { href: "/infra", label: "Инфраструктура", roles: ["supervisor", "leadership", "admin"],
    track: "city",
    hint: "Гидранты, пожарные части, зоны прибытия и «слепые зоны» покрытия" },
  // Аналитик исполняет свободные SELECT по всем районам — доступен только
  // командным ролям (см. api/app/chat.py::ask), поэтому supervisor исключён.
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
  leadership: "/dashboard",
  admin: "/dashboard",
  owner: "/portal",
  dispatcher: "/dispatch",
  responder: "/callout",
};

export const ROLE_LABEL: Record<Role, string> = {
  inspector: "Инспектор",
  supervisor: "Руководитель управления",
  leadership: "Руководство ведомства",
  admin: "Администратор",
  owner: "Владелец объекта",
  dispatcher: "Диспетчер ЦОУ",
  responder: "Начальник караула",
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

/** Which track a given pathname belongs to, or null for untracked/non-nav
 *  routes (e.g. /portal, /login, or a page outside NAV entirely). */
export function trackOfPath(pathname: string): "fire" | "city" | "system" | null {
  const match = NAV.find(
    (n) => pathname === n.href || pathname.startsWith(n.href + "/"),
  );
  return match?.track ?? null;
}

/** True only when a role has at least two visible items in BOTH the fire
 *  and the city track — that's when switching between them is meaningful.
 *  Matrix: supervisor/leadership/admin → true; inspector/dispatcher/
 *  responder/owner → false. */
export function hasTrackSwitch(role: Role): boolean {
  return trackItems(role, "fire").length >= 2 && trackItems(role, "city").length >= 2;
}
