"use client";

/* Dependency-free locale controller — client-context switch, no URL locale
   segments. Mirrors lib/theme.tsx exactly: a render-blocking script sets
   <html lang> before first paint from localStorage, this provider mirrors that
   into React and writes explicit changes back.

   Translation model: the translation KEY is the Russian source string. Russian
   is canonical (identity `t`); en/kk look up merged per-domain dictionaries
   (lib/i18n/index.ts), silently falling back to the Russian string on a miss.
   Kazakh is Cyrillic script. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DICT } from "./i18n/index";

export type Locale = "ru" | "kk" | "en";

const STORAGE_KEY = "fw-locale";

/** BCP-47 tag for Intl APIs (`.toLocaleDateString()`, `Intl.NumberFormat`, …). */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : locale === "kk" ? "kk-KZ" : "ru-RU";
}

/**
 * Fixed IANA zone for every date/time formatted in the app — the pilot is
 * Astana, and every user (ДЧС, акимат) is in this zone regardless of a given
 * device's own clock/timezone setting. Passing this explicitly to every
 * `toLocaleString`/`toLocaleDateString`/`Intl.DateTimeFormat` call makes the
 * formatted text a pure function of the ISO timestamp: without it, the
 * runtime's OS timezone decides the output, and a build/serve container
 * (commonly UTC) formatting the same instant differently from a browser in
 * Asia/Almaty is a hydration mismatch (React error #418) waiting to happen —
 * near a day boundary, the calendar date itself can differ.
 */
export const FW_TIME_ZONE = "Asia/Almaty";

/** Calendar day (`YYYY-MM-DD`) of an instant in `FW_TIME_ZONE` — for "is this
 *  the same day as X" checks that must agree between server and client (a
 *  plain `Date#toDateString()` compare uses the runtime's own timezone, which
 *  differs between a server container and a browser in Astana). */
export function fwDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* Inline, render-blocking: runs before first paint so <html lang> is correct
   from the very first render (no flash, correct hyphenation/spellcheck/AT). No
   default is persisted — a first visit reads as "ru". Kept in sync with
   setLocale() below. */
export const LOCALE_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("${STORAGE_KEY}");
    var l = (stored === "ru" || stored === "kk" || stored === "en") ? stored : "ru";
    document.documentElement.lang = l;
  } catch (e) {}
})();
`;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Initialise from the lang the blocking script already set (ru on server).
  const [locale, setLocaleState] = useState<Locale>("ru");

  useEffect(() => {
    const l = document.documentElement.lang;
    if (l === "kk" || l === "en" || l === "ru") setLocaleState(l);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within <LocaleProvider>");
  }
  return ctx;
}

/**
 * Translate hook. Returns `t(ru)` where the Russian source string IS the key.
 * For `ru` it is identity; for `en`/`kk` it looks up the merged dictionary and
 * silently returns the Russian string on a miss.
 */
export function useT(): (ru: string) => string {
  const { locale } = useLocale();
  return useCallback(
    (ru: string) => {
      if (locale === "ru") return ru;
      const table = locale === "en" ? DICT.en : DICT.kk;
      return table[ru] ?? ru;
    },
    [locale],
  );
}
