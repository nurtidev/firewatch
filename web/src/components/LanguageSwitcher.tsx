"use client";

/* Compact language segmented control (ҚАЗ / РУС / ENG). Mirrors the Tabs
   primitive's token styling so it reads as one system in dark (default) and
   .light. The Languages icon pairs with text so colour is never the only
   signal. Persists via LocaleProvider (localStorage fw-locale, <html lang>). */

import { Languages } from "lucide-react";
import { useLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/cn";

const OPTIONS: { id: Locale; label: string }[] = [
  { id: "kk", label: "ҚАЗ" },
  { id: "ru", label: "РУС" },
  { id: "en", label: "ENG" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      role="radiogroup"
      aria-label="Язык интерфейса"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5",
        className,
      )}
    >
      <Languages className="ml-1 mr-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
      {OPTIONS.map((o) => {
        const selected = o.id === locale;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setLocale(o.id)}
            className={cn(
              "rounded px-1.5 py-1 font-mono text-2xs font-semibold uppercase tracking-wider transition-colors duration-[var(--dur-fast)]",
              selected
                ? "bg-surface-3 text-fg shadow-card"
                : "text-faint hover:bg-surface-2 hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
