"use client";

import * as React from "react";
import {
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  Info,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SEVERITY, type Severity, type SeverityMeta } from "@/lib/risk";

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
type ButtonSize = "sm" | "md";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary:
    "border border-border-strong bg-surface-2 text-fg hover:bg-surface-3",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-critical text-white hover:opacity-90",
  success: "bg-normal text-accent-fg hover:opacity-90",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
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
        className="h-full rounded-full transition-[width] duration-[var(--dur)]"
        style={{
          width: `${pct}%`,
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

/* ============================== Live / timestamp ============================== */

export function LiveIndicator({
  updated,
  className,
}: {
  updated?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-faint", className)}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="fw-live-dot absolute inline-flex h-full w-full rounded-full bg-normal" />
      </span>
      <span className="uppercase tracking-wider text-normal">Live</span>
      {updated && <span className="text-faint">· обновлено {updated}</span>}
    </span>
  );
}
