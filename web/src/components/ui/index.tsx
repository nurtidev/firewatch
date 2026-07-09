"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  Info,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SEVERITY, type Severity, type SeverityMeta } from "@/lib/risk";
import { useT } from "@/lib/i18n";

/* ============================== Motion helpers ============================== */

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Mount/unmount presence for parent-driven overlays (a boolean `open`).
 * Keeps the element mounted through its exit transition, then unmounts.
 * `visible` drives the enter/exit styles; flip it via a two-frame delay so the
 * initial (hidden) state paints before the browser transitions to shown.
 * Under prefers-reduced-motion it resolves synchronously (no motion, no delay).
 */
export function usePresence(open: boolean, exitMs = 140) {
  const [mounted, setMounted] = React.useState(open);
  const [visible, setVisible] = React.useState(open);
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      if (prefersReducedMotion()) {
        setVisible(true);
        return;
      }
      const r = requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true)),
      );
      return () => cancelAnimationFrame(r);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);
  return { mounted, visible };
}

/**
 * Self-closing presence for modal-like components that own their `onClose`.
 * `visible` starts hidden then flips true (enter); `requestClose()` plays the
 * exit, then calls `onClose` after `exitMs` (so the parent unmounts only once
 * the exit has run). Respects prefers-reduced-motion (instant, no delay).
 */
export function useDismiss(onClose: () => void, exitMs = 140) {
  const [visible, setVisible] = React.useState(false);
  const closing = React.useRef(false);
  React.useEffect(() => {
    if (prefersReducedMotion()) {
      setVisible(true);
      return;
    }
    const r = requestAnimationFrame(() =>
      requestAnimationFrame(() => setVisible(true)),
    );
    return () => cancelAnimationFrame(r);
  }, []);
  const requestClose = React.useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setVisible(false);
    setTimeout(onClose, exitMs);
  }, [onClose, exitMs]);
  return { visible, requestClose };
}

/* ============================== Surfaces ============================== */

export function Card({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface shadow-card",
        interactive &&
          "transition-colors duration-[var(--dur-fast)] hover:border-border-strong hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

/** Micro section label — uppercase, tracked, faint. */
export function SectionLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "text-2xs font-medium uppercase tracking-[0.14em] text-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Page header: title, subtitle, right-aligned actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ============================== Severity ============================== */

export const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  critical: AlertOctagon,
  high: AlertTriangle,
  elevated: AlertCircle,
  normal: ShieldCheck,
  info: Info,
};

/** Status chip — color + icon + word. Never color alone (a11y / colorblind). */
export function StatusChip({
  severity,
  label,
  icon = true,
  className,
}: {
  severity: SeverityMeta;
  label?: React.ReactNode;
  icon?: boolean;
  className?: string;
}) {
  const Icon = SEVERITY_ICON[severity.key];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        severity.bg,
        severity.text,
        severity.border,
        className,
      )}
    >
      {icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {label ?? severity.label}
    </span>
  );
}

/** Risk score 0–100 with its severity color, tabular. */
export function ScoreBadge({
  score,
  severity,
  className,
}: {
  score: number;
  severity: SeverityMeta;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[2.25rem] items-center justify-center rounded-md border px-1.5 py-0.5 text-sm font-semibold tabular",
        severity.bg,
        severity.text,
        severity.border,
        className,
      )}
    >
      {score}
    </span>
  );
}

/* ============================== Banner ============================== */

type BannerTone = "warning" | "info" | "critical";

const BANNER_TONE: Record<BannerTone, { sev: SeverityMeta; icon: LucideIcon }> = {
  warning: { sev: SEVERITY.elevated, icon: AlertTriangle },
  info: { sev: SEVERITY.info, icon: Info },
  critical: { sev: SEVERITY.critical, icon: AlertOctagon },
};

/** Inline callout for context-wide notices (e.g. demo data, degraded mode). */
export function Banner({
  tone = "warning",
  title,
  children,
  icon,
  className,
}: {
  tone?: BannerTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const { sev, icon: ToneIcon } = BANNER_TONE[tone];
  const Icon = icon ?? ToneIcon;
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs",
        sev.bg,
        sev.border,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", sev.text)} aria-hidden />
      <div className="min-w-0">
        {title && <div className={cn("font-semibold", sev.text)}>{title}</div>}
        {children && (
          <div className={cn("text-muted", Boolean(title) && "mt-0.5")}>{children}</div>
        )}
      </div>
    </div>
  );
}

/* ============================== Badge ============================== */

export function Badge({
  className,
  children,
  tone = "neutral",
}: {
  className?: string;
  children: React.ReactNode;
  tone?: "neutral" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        tone === "accent"
          ? "border-accent/30 bg-accent-weak text-accent"
          : "border-border bg-surface-2 text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ============================== Metric card ============================== */

export function MetricCard({
  label,
  value,
  unit,
  severity,
  hint,
  icon: Icon,
  loading,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  severity?: SeverityMeta;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("relative overflow-hidden p-4", className)}>
      {severity && (
        <span
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: severity.cssVar }}
          aria-hidden
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        {Icon && <Icon className="h-4 w-4 text-faint" aria-hidden />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <div className="mt-1.5 flex items-baseline gap-1">
          <span
            className={cn(
              "text-2xl font-semibold tabular leading-none",
              severity ? severity.text : "text-fg",
            )}
          >
            {value}
          </span>
          {unit && <span className="text-sm text-muted">{unit}</span>}
        </div>
      )}
      {hint && !loading && (
        <div className="mt-2 text-xs text-faint">{hint}</div>
      )}
    </Card>
  );
}

/* ============================== Button ============================== */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg" | "xl";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[color,background-color,border-color,scale] duration-[var(--dur-fast)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary:
    "border border-border-strong bg-surface-2 text-fg hover:bg-surface-3",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  // Near-black on --critical red = 5.8:1 (white was 3.4:1, failing AA in both
  // themes). accent-fg is near-black in dark and light, so this holds everywhere.
  danger: "bg-critical text-accent-fg hover:opacity-90",
  success: "bg-normal text-accent-fg hover:opacity-90",
};
// sm/md = dense desktop. lg/xl = field touch targets (≥44px) — one-handed use on
// a phone; the WCAG 2.5.5 / mobile-ergonomics minimum is 44px.
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
  lg: "h-11 px-4 text-sm",
  xl: "h-12 px-5 text-[15px]",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)}
      {...props}
    />
  );
}

/** Button-styled Next.js link — for navigation that should read as a primary
 *  action (e.g. "Открыть ПТП" from a callout pack), not a plain text link. */
export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  href,
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link
      href={href}
      className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)}
      {...props}
    />
  );
}

/* ============================== Form controls ============================== */

const FIELD =
  "w-full rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-fg transition-colors duration-[var(--dur-fast)] placeholder:text-faint hover:border-faint focus:border-accent";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, "h-9", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, "py-2 leading-relaxed", className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD, "h-9 cursor-pointer pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/* ============================== Progress ============================== */

export function ProgressBar({
  value,
  max = 100,
  severity,
  className,
}: {
  value: number;
  max?: number;
  severity?: SeverityMeta;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((100 * value) / max)) : 0;
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
    >
      <div
        className="h-full w-full origin-left rounded-full transition-transform duration-[var(--dur)]"
        style={{
          transform: `scaleX(${pct / 100})`,
          background: severity ? severity.cssVar : "var(--color-accent)",
        }}
      />
    </div>
  );
}

/* ============================== Skeleton ============================== */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-surface-2",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[fw-shimmer_1.5s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/[0.04] after:to-transparent",
        className,
      )}
    />
  );
}

/* ============================== Empty / error ============================== */

export function EmptyState({
  icon: Icon = Info,
  title,
  description,
  action,
  tone = "neutral",
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "error";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/40 px-6 py-12 text-center",
        className,
      )}
    >
      <Icon
        className={cn(
          "h-7 w-7",
          tone === "error" ? "text-critical" : "text-faint",
        )}
        aria-hidden
      />
      <div className="mt-3 text-sm font-medium text-fg">{title}</div>
      {description && (
        <div className="mt-1 max-w-sm text-xs text-muted">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ============================== Tabs ============================== */

export type TabItem = {
  id: string;
  label: React.ReactNode;
  icon?: LucideIcon;
  /** optional count chip (info scent — how much is behind the tab) */
  count?: number;
};

/**
 * Segmented tab bar — keyboard-navigable (←/→/Home/End), roving tabindex.
 * Controlled: parent owns `active` and conditionally renders the matching panel.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    if (i < 0) return;
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
  };
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKey}
      className={cn(
        "flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1",
        className,
      )}
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--dur-fast)]",
              selected
                ? "bg-surface-3 text-fg shadow-card"
                : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  "ml-0.5 rounded px-1 text-2xs tabular",
                  selected ? "bg-surface-2 text-muted" : "text-faint",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ============================== Collapsible ============================== */

/** Disclosure for long, secondary content (source notes, provenance). */
export function Collapsible({
  title,
  children,
  defaultOpen = false,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cn("rounded-lg border border-border bg-surface-2", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm font-medium text-fg transition-colors duration-[var(--dur-fast)] hover:bg-surface-3 rounded-lg"
      >
        <span className="min-w-0">{title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-faint transition-transform duration-[var(--dur-fast)]",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="border-t border-border px-3.5 py-3 text-sm leading-relaxed text-muted">
          {children}
        </div>
      )}
    </div>
  );
}

/* ============================== Live / timestamp ============================== */

export function LiveIndicator({
  updated,
  className,
}: {
  updated?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-faint", className)}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="fw-live-dot absolute inline-flex h-full w-full rounded-full bg-normal" />
      </span>
      <span className="uppercase tracking-wider text-normal">Live</span>
      {updated && <span className="text-faint">· {t("обновлено")} {updated}</span>}
    </span>
  );
}
