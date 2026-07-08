"use client";

/**
 * One row in a callout list — shared by the ЦОУ console (/dispatch, compact
 * `size="sm"`) and the responder tablet (/callout, big-touch `size="lg"`) so
 * the two surfaces never drift on what a row shows (incl. the «· закрыт»
 * marker, which used to only appear on the dispatcher's list).
 */
import { cn } from "@/lib/cn";
import { CALLOUT_TYPE_META, relativeTimeRu, type Callout } from "@/lib/dispatch";
import { useLocale, useT } from "@/lib/i18n";

export default function CalloutRow({
  callout,
  size = "sm",
  active = false,
  onClick,
}: {
  callout: Callout;
  /** "sm" — dispatcher's list column. "lg" — responder tablet, arm's-length. */
  size?: "sm" | "lg";
  /** Highlights the row as the currently open pack (sm only). */
  active?: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const meta = CALLOUT_TYPE_META[callout.callout_type];
  const Icon = meta.icon;
  const large = size === "lg";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-[var(--dur-fast)]",
        large && "items-center gap-4 rounded-xl border-2 p-4 sm:p-5",
        active
          ? "border-accent bg-surface-2"
          : "border-border bg-surface hover:border-border-strong hover:bg-surface-2",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg",
          large ? "h-14 w-14 rounded-xl" : "h-8 w-8",
          meta.severity.bg,
        )}
        aria-hidden
      >
        <Icon className={cn(large ? "h-7 w-7" : "h-4 w-4", meta.severity.text)} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            large ? "truncate text-lg font-semibold text-fg sm:text-xl" : "truncate text-sm font-medium text-fg",
            !callout.address && "tabular",
          )}
        >
          {callout.address || `${callout.lat.toFixed(4)}, ${callout.lng.toFixed(4)}`}
        </p>
        <p
          className={cn(
            large
              ? "mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted"
              : "mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-faint",
          )}
        >
          <span className={cn(large && "font-medium", meta.severity.text)}>{t(meta.label)}</span>
          <span className="tabular">· {relativeTimeRu(callout.created_at, locale, t)}</span>
          {callout.station && <span className="truncate">· {callout.station.name}</span>}
          {callout.status === "closed" && <span>· {t("закрыт")}</span>}
        </p>
      </div>
    </button>
  );
}
