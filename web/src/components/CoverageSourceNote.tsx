"use client";

import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import {
  COVERAGE_SOURCE_ICON,
  COVERAGE_SOURCE_LABEL,
  type CoverageSource,
} from "@/lib/city";

/**
 * How a city-wide coverage/arrival figure was computed — reused next to the
 * demo-data plaque, inside the "Методика" disclosure, and on the printed
 * /city/report. Always icon + text (hard rule 4: color is never the only
 * signal); the muted/elevated tint is a secondary reinforcement, not the
 * only cue — `buffer`/`mixed` read as visually softer BECAUSE the text next
 * to the icon already says "оценка сверху" / "частично по прямой".
 */
export default function CoverageSourceNote({
  source,
  approximate,
  className,
}: {
  source: CoverageSource;
  approximate?: boolean;
  className?: string;
}) {
  const t = useT();
  const Icon = COVERAGE_SOURCE_ICON[source];
  const soft = source !== "osrm";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-2xs",
        soft ? "text-elevated" : "text-muted",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {t(COVERAGE_SOURCE_LABEL[source])}
      {approximate && (
        <span className="text-faint">· {t("оценка приблизительная")}</span>
      )}
    </span>
  );
}
