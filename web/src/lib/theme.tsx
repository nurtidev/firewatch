"use client";

/* Dependency-free theme controller.
   Per-surface default: the marketing landing ("/") is light-first (calm,
   welcoming), the mission-critical app is dark-first (control-room). Once the
   user explicitly toggles, THAT choice is persisted and wins everywhere — the
   per-path default only applies until then. A ?theme= query param always wins
   for the current load. The blocking script in layout.tsx sets the class on
   <html> before paint, so there is no flash — this provider only mirrors that
   state into React and writes explicit changes back. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "fw-theme";
const EXPLICIT_KEY = "fw-theme-set"; // "1" once the user has toggled themselves

/* Inline, render-blocking: runs before first paint to avoid FOUC.
   Resolution order: ?theme= query param → the user's explicit stored choice →
   per-path default (marketing landings light, app dark). The marketing surfaces
   ("/", "/gov", "/business") are light-first (calm, welcoming); everything else
   is the dark-first control room. No default is persisted, so a later visit to a
   different surface still gets that surface's default until the user opts in.
   Kept in sync with applyTheme() / setTheme() below. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var q = new URLSearchParams(location.search).get("theme");
    var explicit = localStorage.getItem("${EXPLICIT_KEY}") === "1";
    var stored = localStorage.getItem("${STORAGE_KEY}");
    var p = location.pathname;
    var lightFirst = (p === "/" || p === "/gov" || p === "/business");
    var t;
    if (q === "light" || q === "dark") t = q;
    else if (explicit && (stored === "light" || stored === "dark")) t = stored;
    else t = (lightFirst ? "light" : "dark");
    var c = document.documentElement.classList;
    c.remove("light", "dark");
    c.add(t);
  } catch (e) {}
})();
`;

function applyTheme(theme: Theme) {
  const c = document.documentElement.classList;
  c.remove("light", "dark");
  c.add(theme);
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialise from the class the blocking script already set (dark on server).
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const current =
      document.documentElement.classList.contains("light") ? "light" : "dark";
    setThemeState(current);
    // Enable smooth palette transitions only after first mount, so the initial
    // paint is not animated.
    document.documentElement.classList.add("fw-theme-ready");
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      // An explicit choice is persisted and now wins over the per-path default.
      localStorage.setItem(STORAGE_KEY, t);
      localStorage.setItem(EXPLICIT_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}
