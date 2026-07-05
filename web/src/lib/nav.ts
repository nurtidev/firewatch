import type { Role } from "./auth";

export type NavItem = {
  href: string;
  label: string;
  roles: Role[];
  /** Optional plain-language expansion, shown as a tooltip on hover — so
   *  domain jargon in the label never reads as an unexplained abbreviation. */
  hint?: string;
};

// Order = sidebar order. Each module is visible only to the listed roles.
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Дашборд", roles: ["supervisor", "leadership", "admin"] },
  { href: "/routes", label: "План инспекций", roles: ["inspector", "supervisor", "admin"] },
  { href: "/control", label: "Контроль выполнения", roles: ["supervisor", "admin"] },
  { href: "/reports", label: "Донесения", roles: ["inspector", "supervisor", "leadership", "admin"],
    hint: "Полевые донесения: заблокированные проезды, неисправные гидранты — вне плановых проверок" },
  { href: "/map", label: "Карта риска", roles: ["inspector", "supervisor", "leadership", "admin"] },
  { href: "/cards", label: "Оперкарточки", roles: ["inspector", "supervisor", "admin"],
    hint: "Оперативные карточки пожаротушения (ПТП) — распознавание скана в структурированные поля" },
  { href: "/infra", label: "Инфраструктура", roles: ["supervisor", "leadership", "admin"],
    hint: "Гидранты, пожарные части, зоны прибытия и «слепые зоны» покрытия" },
  { href: "/forces", label: "Расчёт сил и средств", roles: ["supervisor", "admin"],
    hint: "Калькулятор сил и средств на тушение по методике расчёта" },
  // Аналитик исполняет свободные SELECT по всем районам — доступен только
  // командным ролям (см. api/app/chat.py::ask), поэтому supervisor исключён.
  { href: "/chat", label: "ИИ-аналитик", roles: ["leadership", "admin"],
    hint: "Вопрос на естественном языке → ответ строго из данных ДЧС, с источниками" },
  { href: "/model", label: "Модель ИИ", roles: ["leadership", "supervisor", "admin"],
    hint: "Качество риск-модели: метрики и объяснимость (какие факторы влияют на оценку)" },
  { href: "/audit", label: "Журнал аудита", roles: ["leadership", "admin"] },
];

export const DEFAULT_ROUTE: Record<Role, string> = {
  inspector: "/routes",
  supervisor: "/dashboard",
  leadership: "/dashboard",
  admin: "/dashboard",
};

export const ROLE_LABEL: Record<Role, string> = {
  inspector: "Инспектор",
  supervisor: "Руководитель управления",
  leadership: "Руководство ведомства",
  admin: "Администратор",
};

export function navForRole(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}
