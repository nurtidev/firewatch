"use client";

/* Dependency-free theme controller.
   Dark is the default (mission-critical control-room); light is opt-in and
   persisted in localStorage. The blocking script in layout.tsx sets the class
   on <html> before paint, so there is no flash — this provider only mirrors
   that state into React and writes changes back. */

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

/* Inline, render-blocking: runs before first paint to avoid FOUC.
   Kept in sync with applyTheme() below. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var q = new URLSearchParams(location.search).get("theme");
    var t = (q === "light" || q === "dark") ? q : localStorage.getItem("${STORAGE_KEY}");
    if (t !== "light" && t !== "dark") t = "dark";
    localStorage.setItem("${STORAGE_KEY}", t);
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
      localStorage.setItem(STORAGE_KEY, t);
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
