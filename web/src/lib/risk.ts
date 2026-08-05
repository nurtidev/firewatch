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

/**
 * Risk score 0–100 → severity. The canonical thresholds for the whole app.
 *
 * Anchored to the calibrated score distribution, NOT to round numbers: scores
 * are right-skewed (median ~9, p95 ~64, p99 ~83), so the old ≥85 "critical" cut
 * captured <1% of stock and left the highest-attention band effectively empty.
 * These operating points keep every band populated (critical ≈ top ~6%, high ≈
 * next ~10%, elevated ≈ next ~20%) so the ranking is actionable. Re-check these
 * against the real distribution after retraining on ДЧС data.
 * Keep in sync with: api RISK_BANDS, chat SCHEMA_DOC, map legend/filter.
 */
export function scoreSeverity(score: number): SeverityMeta {
  if (score >= 60) return SEVERITY.critical;
  if (score >= 40) return SEVERITY.high;
  if (score >= 20) return SEVERITY.elevated;
  return SEVERITY.normal;
}

/** Short risk band label, e.g. for legends. */
export function scoreBand(score: number): string {
  if (score >= 60) return "Критический";
  if (score >= 40) return "Высокий";
  if (score >= 20) return "Средний";
  return "Низкий";
}

/**
 * One-line explanation of what a risk-score severity means in plain language —
 * for surfaces that answer "why is this object rated like this" to someone
 * outside the ДЧС (the owner portal). Not reused for other SEVERITY usages
 * (visit/remediation status chips), which have their own meaning per badge.
 */
export const SCORE_HINT: Record<Severity, string> = {
  critical: "Здание в приоритете проверок ДЧС — требуются срочные меры.",
  high: "Риск выше среднего — объект проверяется чаще нормативного интервала.",
  elevated: "Есть отдельные факторы риска, которые стоит держать под контролем.",
  normal: "Существенных факторов пожарного риска не выявлено.",
  info: "",
};

/**
 * Human-readable Russian labels for the model's feature names. Single source for
 * the building panel (SHAP) and the model page (feature importance) — an
 * inspector must never see `wooden_floors`, only «Деревянные перекрытия».
 */
export const FEATURE_LABELS: Record<string, string> = {
  age_years: "Возраст здания",
  floors: "Этажность",
  wooden_floors: "Деревянные перекрытия",
  has_fire_alarm: "Пожарная сигнализация",
  incidents_300m_3y: "Инциденты рядом (300 м / 3 г.)",
  block_density: "Плотность застройки",
  winter_season: "Зимний период",
  nearest_hydrant_m: "Расстояние до гидранта",
  capital_repair_recent: "Недавний капремонт",
};

/** Translate a feature name, falling back to the raw name if unmapped. */
export function featureLabel(name: string): string {
  return FEATURE_LABELS[name] ?? name;
}
