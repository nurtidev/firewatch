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
  Users,
  Siren,
  Radio,
  Flame,
  Building2,
  Landmark,
  Menu,
  X,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  NAV,
  navForRole,
  trackItems,
  trackOfPath,
  hasTrackSwitch,
  TRACKS,
  SECTION_LABEL,
  SYSTEM_GROUP_LABEL,
  DEFAULT_ROUTE,
  ROLE_LABEL,
  type NavItem,
} from "@/lib/nav";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { usePresence, SectionLabel } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { FireWatchMark } from "@/components/FireWatchMark";

const ICONS: Record<string, LucideIcon> = {
  "/portal": Building2,
  "/dispatch": Radio,
  "/callout": Flame,
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
  "/users": Users,
};

// TRACKS in lib/nav.ts names icons by string, not component, so nav.ts stays
// free of lucide-react imports — resolved here the same way ICONS is.
const TRACK_ICONS: Record<"flame" | "landmark", LucideIcon> = {
  flame: Flame,
  landmark: Landmark,
};

const TRACK_STORAGE_KEY = "fw_track";

/** SSR-safe: only ever called from effects/handlers, never from render. */
function readStoredTrack(): "fire" | "city" | null {
  try {
    const v = localStorage.getItem(TRACK_STORAGE_KEY);
    return v === "fire" || v === "city" ? v : null;
  } catch {
    return null;
  }
}

function writeStoredTrack(track: "fire" | "city") {
  try {
    localStorage.setItem(TRACK_STORAGE_KEY, track);
  } catch {
    // Private browsing / disabled storage — the switch still works for the
    // session, it just won't be remembered on the next system-page visit.
  }
}

type NavGroup = { heading?: string; items: NavItem[] };

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
  const t = useT();
  const [drawer, setDrawer] = useState(false);
  // Keep the drawer mounted through its slide-out so close animates too.
  const drawerPresence = usePresence(drawer, 150);

  // Pure function of the current route — safe to call during render (no
  // hydration mismatch risk, unlike localStorage below).
  const pathTrack = trackOfPath(pathname);

  // On a route that belongs to neither track (system pages, non-NAV pages),
  // the active track comes from localStorage instead — resolved in an
  // effect only, never read during render (SSR has no localStorage).
  const [storedTrack, setStoredTrack] = useState<"fire" | "city" | null>(null);

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
    if (match) {
      const allowed = match.extraAccessRoles
        ? [...match.roles, ...match.extraAccessRoles]
        : match.roles;
      if (!allowed.includes(user.role)) {
        router.replace(DEFAULT_ROUTE[user.role]);
      }
    }
  }, [ready, user, router, pathname]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  // Resolve the "last chosen track" fallback for non-tracked routes: stored
  // choice, else the track of the role's default route, else "fire".
  useEffect(() => {
    if (pathTrack === "fire" || pathTrack === "city") return;
    if (!user) return;
    const stored = readStoredTrack();
    if (stored) {
      setStoredTrack(stored);
      return;
    }
    const fallback = trackOfPath(DEFAULT_ROUTE[user.role]);
    setStoredTrack(fallback === "fire" || fallback === "city" ? fallback : "fire");
  }, [pathTrack, user]);

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        {t("Загрузка…")}
      </div>
    );
  }

  const switchEnabled = hasTrackSwitch(user.role);
  const activeTrack: "fire" | "city" =
    pathTrack === "fire" || pathTrack === "city" ? pathTrack : (storedTrack ?? "fire");

  function selectTrack(next: "fire" | "city") {
    if (next === activeTrack) return;
    writeStoredTrack(next);
    setStoredTrack(next);
    const defaultRoute = DEFAULT_ROUTE[user!.role];
    const target =
      trackOfPath(defaultRoute) === next ? defaultRoute : trackItems(user!.role, next)[0]?.href;
    if (target) router.push(target);
  }

  // Build the sidebar's groups. With the switch, only the active track's
  // items show (fire split into its two sections); the system group is
  // always appended. Without it, every visible item shows, grouped — but
  // headings render only when the role's items actually span more than one
  // group (a single-item role like owner gets a flat, headingless list).
  let groups: NavGroup[];
  if (switchEnabled) {
    groups = [];
    if (activeTrack === "fire") {
      const response = trackItems(user.role, "fire").filter((n) => n.section === "response");
      const prevention = trackItems(user.role, "fire").filter((n) => n.section === "prevention");
      if (response.length) groups.push({ heading: SECTION_LABEL.response, items: response });
      if (prevention.length) groups.push({ heading: SECTION_LABEL.prevention, items: prevention });
    } else {
      groups.push({ items: trackItems(user.role, "city") });
    }
    const system = trackItems(user.role, "system");
    if (system.length) groups.push({ heading: SYSTEM_GROUP_LABEL, items: system });
  } else {
    const all = navForRole(user.role);
    const buckets: NavGroup[] = [
      { items: all.filter((n) => !n.track) },
      { heading: SECTION_LABEL.response, items: all.filter((n) => n.track === "fire" && n.section === "response") },
      { heading: SECTION_LABEL.prevention, items: all.filter((n) => n.track === "fire" && n.section === "prevention") },
      { heading: TRACKS.city.label, items: all.filter((n) => n.track === "city") },
      { heading: SYSTEM_GROUP_LABEL, items: all.filter((n) => n.track === "system") },
    ].filter((g) => g.items.length > 0);
    const multiGroup = buckets.length > 1;
    groups = multiGroup ? buckets : buckets.map((g) => ({ items: g.items }));
  }

  // A render helper, not an inline component: a component declared inside
  // render gets a new identity every render, so React would remount every
  // link (losing focus/hover) on each AppShell update.
  const renderNavLink = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(item.href + "/");
    const Icon = ICONS[item.href] ?? LayoutDashboard;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setDrawer(false)}
        title={item.hint ? t(item.hint) : undefined}
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
        <span className="truncate">{t(item.label)}</span>
      </Link>
    );
  };

  const Sidebar = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center justify-between px-5 pb-5 pt-5">
        {/* Логотип ведёт на стартовый экран РОЛИ, а не на дашборд: у инспектора,
            владельца объекта, диспетчера и начальника караула доступа к
            дашборду нет, и клик по логотипу давал лишний редирект. */}
        <Link
          href={user ? DEFAULT_ROUTE[user.role] : "/"}
          className="block"
          onClick={() => setDrawer(false)}
        >
          <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <FireWatchMark size={23} />
            FireWatch<span className="text-accent">.</span>
          </div>
          <div className="mt-0.5 text-2xs font-medium uppercase tracking-[0.18em] text-faint">
            {t("ДЧС Астаны")}
          </div>
        </Link>
        <button
          onClick={() => setDrawer(false)}
          className="rounded-md p-1.5 text-muted transition-[color,background-color,scale] duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-fg active:scale-[0.97] lg:hidden"
          aria-label={t("Закрыть меню")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Track switch — only for roles with ≥2 visible items in both tracks */}
      {switchEnabled && (
        <div className="px-3 pb-3">
          <div
            role="group"
            aria-label={t("Трек")}
            className="flex gap-1 rounded-lg border border-border bg-surface p-1"
          >
            {(["fire", "city"] as const).map((trackKey) => {
              const meta = TRACKS[trackKey];
              const Icon = TRACK_ICONS[meta.icon];
              const selected = trackKey === activeTrack;
              return (
                <button
                  key={trackKey}
                  type="button"
                  aria-pressed={selected}
                  title={t(meta.hint)}
                  onClick={() => selectTrack(trackKey)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors duration-[var(--dur-fast)]",
                    selected
                      ? "bg-surface-3 text-fg shadow-card"
                      : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Icon
                    className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-accent" : "text-faint")}
                    aria-hidden
                  />
                  <span className="truncate">{t(meta.label)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-2" aria-label={t("Основная навигация")}>
        {groups.map((group, gi) => (
          <div key={group.heading ?? `group-${gi}`} className={gi === 0 ? "" : "mt-4"}>
            {group.heading && (
              <SectionLabel className="mb-1 px-3">{t(group.heading)}</SectionLabel>
            )}
            <div className="space-y-0.5">
              {group.items.map(renderNavLink)}
            </div>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="mt-auto border-t border-border p-3">
        <div className="mb-1 flex items-center justify-between gap-2 px-2">
          {/* Trigger sits at the bottom of the sidebar — open the menu upward. */}
          <LanguageSwitcher align="left" openUp />
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-fg">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-fg">{user.name}</div>
            <div className="truncate text-2xs text-faint">
              {t(ROLE_LABEL[user.role])}
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="rounded-md p-1.5 text-faint transition-[color,background-color,scale] duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-critical active:scale-[0.97]"
            aria-label={t("Выйти")}
            title={t("Выйти")}
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

      {/* Mobile drawer — slides in from the left, backdrop fades. Enter ~220ms,
          exit faster (~150ms). */}
      {drawerPresence.mounted && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
            aria-hidden
            style={{
              opacity: drawerPresence.visible ? 1 : 0,
              transition: `opacity ${drawerPresence.visible ? 220 : 150}ms var(--ease)`,
            }}
          />
          <aside
            className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface shadow-pop"
            style={{
              transform: drawerPresence.visible ? "translateX(0)" : "translateX(-100%)",
              transition: `transform ${drawerPresence.visible ? 220 : 150}ms var(--ease)`,
            }}
          >
            {Sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <button
            onClick={() => setDrawer(true)}
            className="rounded-md p-1.5 text-muted transition-[color,background-color,scale] duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
            aria-label={t("Открыть меню")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-base font-bold tracking-tight">
            FireWatch<span className="text-accent">.</span>
          </div>
          {switchEnabled && (
            <span className="hidden truncate text-2xs text-faint sm:inline">
              {t(TRACKS[activeTrack].label)}
            </span>
          )}
          <LanguageSwitcher className="ml-auto" />
          <ThemeToggle />
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
