"use client";

/* Compact language dropdown: a quiet Globe + current code (ҚАЗ/РУС/ENG)
   trigger opening a small menu with full native names. Hand-rolled on
   useState/useRef/useEffect (no shadcn in this project). Sits lightly in both
   the landing header (light) and the app sidebar (dark). Persists via
   LocaleProvider (localStorage fw-locale, <html lang>). */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { useLocale, useT, type Locale } from "@/lib/i18n";
import { usePresence } from "@/components/ui";
import { cn } from "@/lib/cn";

// Native language names are intentionally NOT translated (no i18n keys).
const OPTIONS: { id: Locale; code: string; native: string }[] = [
  { id: "kk", code: "ҚАЗ", native: "Қазақша" },
  { id: "ru", code: "РУС", native: "Русский" },
  { id: "en", code: "ENG", native: "English" },
];

export function LanguageSwitcher({
  className,
  align = "right",
  openUp = false,
}: {
  className?: string;
  /** Which edge of the trigger the menu panel is flush with. */
  align?: "left" | "right";
  /** Open the menu above the trigger (e.g. at the bottom of the sidebar). */
  openUp?: boolean;
}) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  // Menu scales in from its anchored corner (~150ms) and out (~120ms).
  const { mounted, visible } = usePresence(open, 120);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.id === locale) ?? OPTIONS[1];

  // Close on click outside / Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("Язык интерфейса")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-2xs font-medium uppercase tracking-wider transition-colors duration-[var(--dur-fast)]",
          open ? "text-fg" : "text-faint hover:text-fg",
        )}
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        {current.code}
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {mounted && (
        <div
          role="menu"
          aria-label={t("Язык интерфейса")}
          className={cn(
            "absolute z-50 min-w-36 rounded-lg border border-border bg-surface p-1 shadow-pop",
            align === "right" ? "right-0" : "left-0",
            openUp ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
          style={{
            transformOrigin: `${openUp ? "bottom" : "top"} ${align === "right" ? "right" : "left"}`,
            opacity: visible ? 1 : 0,
            transform: visible ? "scale(1)" : "scale(0.95)",
            transition: `opacity ${visible ? 150 : 120}ms var(--ease), transform ${
              visible ? 150 : 120
            }ms var(--ease)`,
          }}
        >
          {OPTIONS.map((o) => {
            const selected = o.id === locale;
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setLocale(o.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-2",
                  selected ? "font-medium text-fg" : "text-muted",
                )}
              >
                {o.native}
                {selected && <Check className="h-3.5 w-3.5 text-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
