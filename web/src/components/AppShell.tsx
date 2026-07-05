"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Route,
  Activity,
  Map,
  ScanLine,
  Droplets,
  Calculator,
  Sparkles,
  Brain,
  ShieldCheck,
  Siren,
  Menu,
  X,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { NAV, navForRole, DEFAULT_ROUTE, ROLE_LABEL } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "@/components/ThemeToggle";

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/routes": Route,
  "/control": Activity,
  "/reports": Siren,
  "/map": Map,
  "/cards": ScanLine,
  "/infra": Droplets,
  "/forces": Calculator,
  "/chat": Sparkles,
  "/model": Brain,
  "/audit": ShieldCheck,
};

export default function AppShell({
  children,
  fullBleed = false,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
}) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    // Role is a real access boundary, not just a nav filter: if the user is on a
    // NAV route their role can't see (e.g. deep link, or a role change), bounce
    // them to their default landing page. Non-NAV routes (login, public landings)
    // are left alone. The backend guards enforce this too — this is just UX.
    const match = NAV.find(
      (n) => pathname === n.href || pathname.startsWith(n.href + "/"),
    );
    if (match && !match.roles.includes(user.role)) {
      router.replace(DEFAULT_ROUTE[user.role]);
    }
  }, [ready, user, router, pathname]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Загрузка…
      </div>
    );
  }

  const items = navForRole(user.role);

  const Sidebar = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center justify-between px-5 pb-5 pt-5">
        <Link href="/dashboard" className="block">
          <div className="text-lg font-bold tracking-tight">
            FireWatch<span className="text-accent">.</span>
          </div>
          <div className="mt-0.5 text-2xs font-medium uppercase tracking-[0.18em] text-faint">
            ДЧС РК · Астана
          </div>
        </Link>
        <button
          onClick={() => setDrawer(false)}
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg lg:hidden"
          aria-label="Закрыть меню"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Основная навигация">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = ICONS[item.href] ?? LayoutDashboard;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.hint}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-[var(--dur-fast)]",
                active
                  ? "bg-surface-2 font-medium text-fg"
                  : "text-muted hover:bg-surface/60 hover:text-fg",
              )}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent" />
              )}
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  active ? "text-accent" : "text-faint group-hover:text-muted",
                )}
              />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="mt-auto border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-fg">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-fg">{user.name}</div>
            <div className="truncate text-2xs text-faint">
              {ROLE_LABEL[user.role]}
            </div>
          </div>
          <ThemeToggle />
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-critical"
            aria-label="Выйти"
            title="Выйти"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-bg">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        {Sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface shadow-pop fw-fade-in">
            {Sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <button
            onClick={() => setDrawer(true)}
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Открыть меню"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-base font-bold tracking-tight">
            FireWatch<span className="text-accent">.</span>
          </div>
          <ThemeToggle className="ml-auto" />
        </header>

        <main
          className={
            fullBleed
              ? "relative min-h-0 min-w-0 flex-1"
              : "min-h-0 min-w-0 flex-1 overflow-auto"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
