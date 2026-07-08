"use client";

/* Minimal language switcher (ҚАЗ · РУС · ENG) — a quiet text trio instead of
   a boxed segmented control, so it sits lightly in both the landing header
   (light) and the app sidebar (dark). The active locale is marked by weight +
   an accent underline (form, not colour alone). Persists via LocaleProvider
   (localStorage fw-locale, <html lang>). */

import { useLocale, useT, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/cn";

const OPTIONS: { id: Locale; label: string }[] = [
  { id: "kk", label: "ҚАЗ" },
  { id: "ru", label: "РУС" },
  { id: "en", label: "ENG" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <div
      role="radiogroup"
      aria-label={t("Язык интерфейса")}
      className={cn("inline-flex items-center", className)}
    >
      {OPTIONS.map((o, i) => {
        const selected = o.id === locale;
        return (
          <span key={o.id} className="inline-flex items-center">
            {i > 0 && (
              <span className="mx-1.5 h-3 w-px bg-border" aria-hidden />
            )}
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setLocale(o.id)}
              className={cn(
                "relative rounded-sm px-0.5 py-1 font-mono text-2xs uppercase tracking-wider transition-colors duration-[var(--dur-fast)]",
                selected
                  ? "font-bold text-fg after:absolute after:inset-x-0.5 after:bottom-0 after:h-[2px] after:rounded-full after:bg-accent"
                  : "font-medium text-faint hover:text-fg",
              )}
            >
              {o.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}
