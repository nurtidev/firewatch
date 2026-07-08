"use client";

/* Shared marketing chrome for the umbrella landing ("/") and the two
   audience-split pages ("/gov", "/business"). Extracted so the header, footer
   and repeated primitives (Brand, buttons, section shells, plan visuals) read
   as one system across all three surfaces. Page-specific content stays in the
   page files; only genuinely reused pieces live here. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DEFAULT_ROUTE } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { RealFloorPlan } from "@/data/floorplans/hayvill";

/* ── Contact intents (single source for mailto CTAs) ───────────────────────── */

const CONTACT = "nurtilek.assankhan@gmail.com";
const mail = (subject: string) =>
  `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}`;

export const MAILTO = {
  demo: mail("Запрос демо FireWatch"),
  pilot: mail("Запрос пилота FireWatch — ДЧС"),
  presentation: mail("Презентация платформы FireWatch"),
  business: mail("Оцифровка объекта — FireWatch"),
};

export type NavLink = { href: string; label: string };
export type Cta = { label: string; href: string };

/* Cross-page routes use <Link> (client nav); in-page anchors use <a>. */
function isRoute(href: string) {
  return href.startsWith("/");
}

/* ── Header (shared across the three landing surfaces) ──────────────────────── */

export function LandingHeader({
  navLinks,
  cta,
}: {
  navLinks: NavLink[];
  cta: Cta;
}) {
  const { user } = useAuth();
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const appHref = user ? DEFAULT_ROUTE[user.role] : "/login";
  const appLabel = user ? t("Открыть платформу") : t("Войти");

  const linkClass = "transition-colors hover:text-fg";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 backdrop-blur-xl transition-colors",
        scrolled
          ? "border-b border-border bg-bg/80"
          : "border-b border-transparent bg-bg/60",
      )}
    >
      <div className="mx-auto flex h-[66px] max-w-[1180px] items-center justify-between px-5 sm:px-6">
        <Link href="/" aria-label={t("FireWatch — на главную")}>
          <Brand />
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-muted md:flex lg:gap-8">
          {navLinks.map((l) =>
            isRoute(l.href) ? (
              <Link key={l.href} href={l.href} className={linkClass}>
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href} className={linkClass}>
                {l.label}
              </a>
            ),
          )}
        </nav>
        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline-flex">
            <LanguageSwitcher />
          </span>
          <ThemeToggle className="h-10 w-10 rounded-[12px] border border-border-strong" />
          <Link
            href={appHref}
            className="hidden rounded-[12px] border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-card transition-colors hover:border-faint sm:inline-flex"
          >
            {appLabel}
          </Link>
          <a href={cta.href} className="hidden sm:inline-flex">
            <PrimaryButton>{cta.label}</PrimaryButton>
          </a>
          <button
            onClick={() => setMenu((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-[12px] border border-border-strong text-muted md:hidden"
            aria-label={t("Меню")}
            aria-expanded={menu}
            aria-controls="mobile-nav"
          >
            {menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {menu && (
        <div id="mobile-nav" className="border-t border-border bg-bg px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1">
            {navLinks.map((l) =>
              isRoute(l.href) ? (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenu(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
                >
                  {l.label}
                </Link>
              ) : (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenu(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
                >
                  {l.label}
                </a>
              ),
            )}
            <Link
              href={appHref}
              onClick={() => setMenu(false)}
              className="mt-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-fg hover:bg-surface-2"
            >
              {appLabel}
            </Link>
            <a href={cta.href} className="mt-1" onClick={() => setMenu(false)}>
              <PrimaryButton className="w-full justify-center">{cta.label}</PrimaryButton>
            </a>
            <div className="mt-3 px-1">
              <LanguageSwitcher />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

/* ── Footer ─────────────────────────────────────────────────────────────────── */

export function LandingFooter({ tagline }: { tagline: string }) {
  const t = useT();
  return (
    <footer className="border-t border-border px-5 py-11 text-[13.5px] text-muted sm:px-6">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-5">
        <Link href="/">
          <Brand small />
        </Link>
        <div>{tagline}</div>
        <div className="flex items-center gap-4">
          <Link href="/gov" className="transition-colors hover:text-fg">
            {t("Для ДЧС")}
          </Link>
          <Link href="/business" className="transition-colors hover:text-fg">
            {t("Для бизнеса")}
          </Link>
          <span>© 2026 FireWatch</span>
        </div>
      </div>
    </footer>
  );
}

/* ── Presentational primitives ─────────────────────────────────────────────── */

export function Brand({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 font-extrabold tracking-tight">
      <span
        className={cn(
          "grid place-items-center rounded-[9px] bg-gradient-to-br from-accent to-accent-hover text-white",
          small ? "h-[26px] w-[26px]" : "h-[30px] w-[30px]",
        )}
        style={{
          boxShadow: "0 6px 16px -4px color-mix(in oklab, var(--color-accent) 55%, transparent)",
        }}
      >
        <Flame
          className={small ? "h-3.5 w-3.5" : "h-[17px] w-[17px]"}
          fill="currentColor"
          strokeWidth={0}
        />
      </span>
      <span className={small ? "text-base" : "text-lg"}>
        FireWatch<span className="text-accent">.</span>
      </span>
    </div>
  );
}

export function PrimaryButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-[12px] bg-accent px-[18px] py-2.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover",
        className,
      )}
      style={{
        boxShadow: "0 8px 20px -6px color-mix(in oklab, var(--color-accent) 45%, transparent)",
      }}
    >
      {children}
    </span>
  );
}

export function GhostButton({
  children,
  className,
  href,
}: {
  children: React.ReactNode;
  className?: string;
  href?: string;
}) {
  const cls = cn(
    "inline-flex items-center gap-2 rounded-[12px] border border-border-strong bg-surface px-6 py-3.5 text-[15px] font-semibold text-fg shadow-card transition-colors hover:border-faint",
    className,
  );
  if (href && isRoute(href)) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

export function HeroStat({ n, l }: { n: string; l: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-extrabold tracking-tight tabular">{n}</span>
      <span className="text-[12.5px] font-medium text-muted">{l}</span>
    </div>
  );
}

export function Section({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-[1180px]">{children}</div>
    </section>
  );
}

export function SectionHead({
  eyebrow,
  title,
  sub,
  center,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  center?: boolean;
}) {
  return (
    <div className={cn("max-w-[680px]", center && "mx-auto text-center")}>
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
        {eyebrow}
      </span>
      <h2 className="mt-3.5 text-[clamp(1.6rem,3.6vw,2.5rem)] font-extrabold leading-tight tracking-tight">
        {title}
      </h2>
      <p className="mt-4 text-[17px] leading-relaxed text-muted">{sub}</p>
    </div>
  );
}

/* ── Plan visuals (shared by pipeline + hero skeleton across pages) ─────────── */

/**
 * Small SVG of a real calibrated plan.
 *  • scan   — monochrome zoning boxes (the "before": a flat document).
 *  • vector — polygon outlines in accent (the "vectorised" middle state).
 * Room-type colouring (the "after") is handled by <FloorPlan2D compact /> so the
 * single source of type colours (ROOM_TYPE_META) is never duplicated here.
 */
export function MiniPlan({ plan, mode }: { plan: RealFloorPlan; mode: "scan" | "vector" }) {
  const pad = Math.max(plan.widthM, plan.heightM) * 0.03;
  const vbW = plan.widthM + pad * 2;
  const vbH = plan.heightM + pad * 2;
  const sw = Math.max(plan.widthM, plan.heightM) * 0.014;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {plan.rooms.map((r, i) => {
        const pts = r.polygon.map((p) => p.join(",")).join(" ");
        return mode === "scan" ? (
          <polygon
            key={i}
            points={pts}
            fill="var(--color-surface-3)"
            stroke="var(--color-faint)"
            strokeOpacity={0.6}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
        ) : (
          <polygon
            key={i}
            points={pts}
            fill="var(--color-accent)"
            fillOpacity={0.07}
            stroke="var(--color-accent)"
            strokeOpacity={0.85}
            strokeWidth={sw * 1.3}
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

/** Static, plan-shaped skeleton shown while the 3D chunk loads. */
export function Hero3DSkeleton({ plan }: { plan: RealFloorPlan }) {
  const t = useT();
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklab, var(--color-faint) 12%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--color-faint) 12%, transparent) 1px, transparent 1px)",
          backgroundSize: "26px 26px, 26px 26px",
        }}
        aria-hidden
      />
      <div className="absolute inset-0 grid place-items-center p-10 opacity-70">
        <MiniPlan plan={plan} mode="vector" />
      </div>
      <div className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-[10px] border border-border bg-surface/80 px-2.5 py-1.5 text-[11.5px] text-muted backdrop-blur">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        {t("Загрузка 3D-двойника…")}
      </div>
    </div>
  );
}
