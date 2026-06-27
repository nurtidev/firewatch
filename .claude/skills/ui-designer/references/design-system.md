# FireWatch Design System — token spec & rationale

Read this when defining or extending the design foundation. It is a **starting
point tuned for mission-critical govtech**, not a fixed law — adapt to the
discovery answers, but keep the discipline.

## Principles

1. **Status color is data.** Severity colors carry meaning; never use red/amber
   decoratively. Pair every color signal with an icon or label (accessibility +
   colorblind safety).
2. **Calm, dark, dense.** Duty officers stare at this for hours. Dark neutral
   base, low chrome, high data contrast. No gradients-for-fun.
3. **Tabular everything numeric.** Coordinates, risk scores, counts, timestamps
   use tabular-nums so columns align and scanning is fast.
4. **Restraint = premium.** One accent. Consistent 4px spacing rhythm. Subtle
   elevation. Motion only to explain state.

## Tailwind v4 `@theme` tokens

Put these in [web/src/app/globals.css](../../../web/src/app/globals.css). Tailwind
v4 generates utilities from `@theme` variables (e.g. `--color-critical` →
`bg-critical`, `text-critical`). Keep the existing `--fw-bg`/`--fw-accent` as
aliases if other code references them.

```css
@import "tailwindcss";
@import "maplibre-gl/dist/maplibre-gl.css";

@theme {
  /* Neutral ramp — dark control-room base */
  --color-bg:        #0a0a0b;   /* app background */
  --color-surface:   #131316;   /* cards / panels */
  --color-surface-2: #1b1b20;   /* raised / hover */
  --color-border:    #27272d;   /* hairline dividers */
  --color-muted:     #8a8a93;   /* secondary text */
  --color-fg:        #ededf0;   /* primary text */

  /* Brand */
  --color-accent:      #ff5a1f; /* FireWatch orange — actions, focus */
  --color-accent-weak: #3a1a0e; /* tinted accent bg */

  /* Semantic status (severity scale) — map to real risk levels */
  --color-critical: #ff3b30;  /* немедленная угроза */
  --color-high:     #ff8c1a;  /* высокий риск */
  --color-elevated: #ffd029;  /* повышенный */
  --color-normal:   #2fce7e;  /* норма */
  --color-info:     #3d9bff;  /* справочно / нейтрально */

  /* Status background tints (for chips/rows on dark) */
  --color-critical-bg: #2a0f0e;
  --color-high-bg:     #2a1a0a;
  --color-elevated-bg: #2a260a;
  --color-normal-bg:   #0d2a1c;
  --color-info-bg:     #0d1f2a;

  /* Typography */
  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* Type scale (1.20 minor third) */
  --text-xs:   0.75rem;   /* 12 — labels, meta */
  --text-sm:   0.875rem;  /* 14 — body dense */
  --text-base: 1rem;      /* 16 — body */
  --text-lg:   1.25rem;   /* 20 — section titles */
  --text-xl:   1.5rem;    /* 24 — page titles */
  --text-2xl:  2rem;      /* 32 — hero metrics */

  /* Radius — restrained, not bubbly */
  --radius-sm: 4px;
  --radius:    8px;
  --radius-lg: 12px;

  /* Elevation — subtle on dark */
  --shadow-card: 0 1px 2px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.3);
  --shadow-pop:  0 8px 24px rgba(0,0,0,.5);

  /* Motion */
  --ease: cubic-bezier(.2,.0,.0,1);
  --dur-fast: 150ms;
  --dur:      220ms;
}

/* Numerals: align all metric/coord/count text */
.tabular { font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

## Severity → meaning mapping (use consistently everywhere)

| Token      | Meaning (RU)             | Use                                  |
|------------|--------------------------|--------------------------------------|
| `critical` | Немедленная угроза       | Active incident, must act now        |
| `high`     | Высокий риск             | Prioritize, inspect soon             |
| `elevated` | Повышенный риск          | Watchlist                            |
| `normal`   | В норме                  | OK / resolved                        |
| `info`     | Справочно                | Neutral data, no action              |

A risk score badge, a map marker, and a table row for the *same* object must use
the *same* severity token. Consistency is what makes it read as a real system.

## Component patterns (govtech flavor)

- **Metric card** — big tabular number, tiny label above, delta + trend, a
  "обновлено Nс назад" timestamp. Skeleton while loading.
- **Risk table** — dense rows, tabular numerals, severity chip (color + label +
  icon), sortable, sticky header, keyboard row navigation.
- **Status chip** — `bg-*-bg text-* border` with an icon and a word; never color
  alone.
- **Map overlay** — legend tied to the severity tokens; markers colored by the
  same scale; cluster counts in tabular-nums.
- **Empty / error states** — explicit, with cause + next action ("Нет данных за
  период" / "Сервис ML недоступен — показаны последние известные значения").

## Verification checklist

- [ ] Text contrast ≥ 4.5:1, UI/borders ≥ 3:1 (check on `--color-bg`/`surface`).
- [ ] No raw hex in components — only token utilities.
- [ ] Every severity use pairs color with icon/label.
- [ ] Loading, empty, error, dense states all designed.
- [ ] Visible focus rings; full keyboard nav; ARIA roles on interactive bits.
- [ ] Tabular-nums on all numeric columns.
- [ ] Looks right at control-room width (≥1440) and field tablet (768).
- [ ] Motion respects `prefers-reduced-motion`.
