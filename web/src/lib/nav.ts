import type { Role } from "./auth";

export type NavItem = {
  href: string;
  label: string;
  roles: Role[];
};

// Order = sidebar order. Each module is visible only to the listed roles.
export const NAV: NavItem[] = [
  { href: "/", label: "Дашборд", roles: ["supervisor", "leadership", "admin"] },
  { href: "/routes", label: "План инспекций", roles: ["inspector", "supervisor", "admin"] },
  { href: "/map", label: "Карта риска", roles: ["inspector", "supervisor", "leadership", "admin"] },
  { href: "/cards", label: "Оперкарточки", roles: ["inspector", "supervisor", "admin"] },
  { href: "/infra", label: "Инфраструктура", roles: ["supervisor", "leadership", "admin"] },
  { href: "/forces", label: "Расчёт сил и средств", roles: ["supervisor", "admin"] },
  { href: "/chat", label: "ИИ-аналитик", roles: ["leadership", "supervisor", "admin"] },
];

export const DEFAULT_ROUTE: Record<Role, string> = {
  inspector: "/routes",
  supervisor: "/",
  leadership: "/",
  admin: "/",
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
