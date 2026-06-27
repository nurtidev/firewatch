/**
 * Single source of truth for severity. A risk score, a map marker, a table row,
 * and a chip for the SAME object must resolve to the SAME severity — that
 * consistency is what makes the product read as a real system.
 */
export type Severity = "critical" | "high" | "elevated" | "normal" | "info";

export type SeverityMeta = {
  key: Severity;
  /** Tailwind token utility classes (color = data, never decoration). */
  text: string;
  bg: string;
  border: string;
  dot: string;
  /** raw CSS var, for inline styling on maps/SVG where utilities can't reach. */
  cssVar: string;
  label: string;
};

export const SEVERITY: Record<Severity, SeverityMeta> = {
  critical: {
    key: "critical",
    text: "text-critical",
    bg: "bg-critical-bg",
    border: "border-critical/40",
    dot: "bg-critical",
    cssVar: "var(--color-critical)",
    label: "Критический",
  },
  high: {
    key: "high",
    text: "text-high",
    bg: "bg-high-bg",
    border: "border-high/40",
    dot: "bg-high",
    cssVar: "var(--color-high)",
    label: "Высокий",
  },
  elevated: {
    key: "elevated",
    text: "text-elevated",
    bg: "bg-elevated-bg",
    border: "border-elevated/40",
    dot: "bg-elevated",
    cssVar: "var(--color-elevated)",
    label: "Повышенный",
  },
  normal: {
    key: "normal",
    text: "text-normal",
    bg: "bg-normal-bg",
    border: "border-normal/40",
    dot: "bg-normal",
    cssVar: "var(--color-normal)",
    label: "В норме",
  },
  info: {
    key: "info",
    text: "text-info",
    bg: "bg-info-bg",
    border: "border-info/40",
    dot: "bg-info",
    cssVar: "var(--color-info)",
    label: "Справочно",
  },
};

/** Risk score 0–100 → severity. The canonical thresholds for the whole app. */
export function scoreSeverity(score: number): SeverityMeta {
  if (score >= 85) return SEVERITY.critical;
  if (score >= 71) return SEVERITY.high;
  if (score >= 36) return SEVERITY.elevated;
  return SEVERITY.normal;
}

/** Short risk band label, e.g. for legends. */
export function scoreBand(score: number): string {
  if (score >= 85) return "Критический";
  if (score >= 71) return "Высокий";
  if (score >= 36) return "Средний";
  return "Низкий";
}
