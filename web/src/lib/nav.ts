import type { Role } from "./auth";

export type NavItem = {
  href: string;
  label: string;
  roles: Role[];
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

// Order = sidebar order. Each module is visible only to the listed roles.
export const NAV: NavItem[] = [
  { href: "/portal", label: "Мой объект", roles: ["owner"] },
  { href: "/dispatch", label: "Пульт ЦОУ", roles: ["dispatcher", "admin"],
    hint: "Регистрация боевого выезда и боевой пакет караулу" },
  { href: "/callout", label: "Боевой выезд", roles: ["responder", "dispatcher", "admin"],
    hint: "Оперативный пакет по выезду: ПТП, гидранты, препятствия проезда" },
  { href: "/dashboard", label: "Дашборд", roles: ["supervisor", "leadership", "admin"] },
  { href: "/routes", label: "План инспекций", roles: ["inspector", "supervisor", "admin"] },
  { href: "/control", label: "Контроль выполнения", roles: ["supervisor", "admin"] },
  { href: "/vehicles", label: "Силы и техника", roles: ["responder", "dispatcher", "supervisor", "leadership", "admin"],
    hint: "Состояние машин по частям и сводка выездов: чем расчёт сил обеспечен фактически" },
  { href: "/reports", label: "Донесения", roles: ["inspector", "supervisor", "leadership", "admin", "dispatcher", "responder"],
    hint: "Полевые донесения: заблокированные проезды, неисправные гидранты — вне плановых проверок" },
  { href: "/map", label: "Карта риска", roles: ["inspector", "supervisor", "leadership", "admin"] },
  { href: "/cards", label: "Оперкарточки", roles: ["inspector", "supervisor", "admin"],
    hint: "Оперативные карточки пожаротушения (ПТП) — распознавание скана в структурированные поля",
    extraAccessRoles: ["dispatcher", "responder"] },
  { href: "/infra", label: "Инфраструктура", roles: ["supervisor", "leadership", "admin"],
    hint: "Гидранты, пожарные части, зоны прибытия и «слепые зоны» покрытия" },
  { href: "/forces", label: "Расчёт сил и средств", roles: ["supervisor", "admin"],
    hint: "Калькулятор сил и средств на тушение по методике расчёта",
    extraAccessRoles: ["dispatcher", "responder"] },
  // Аналитик исполняет свободные SELECT по всем районам — доступен только
  // командным ролям (см. api/app/chat.py::ask), поэтому supervisor исключён.
  { href: "/chat", label: "ИИ-аналитик", roles: ["leadership", "admin"],
    hint: "Вопрос на естественном языке → ответ строго из данных ДЧС, с источниками" },
  { href: "/model", label: "Модель ИИ", roles: ["leadership", "supervisor", "admin"],
    hint: "Качество риск-модели: метрики и объяснимость (какие факторы влияют на оценку)" },
  { href: "/audit", label: "Журнал аудита", roles: ["leadership", "admin"] },
  // Приём/отключение сотрудников и сброс паролей — привилегированная операция,
  // строго admin (см. require_roles("admin") в api/app/routers/auth.py).
  { href: "/users", label: "Пользователи", roles: ["admin"],
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

export function navForRole(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}
