"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

interface ThemeCtx {
  readonly isDark: boolean;
  readonly toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const THEME_KEY = "agentsea-theme";
const LEGACY_THEME_KEY = "grid-agentsea-theme";

function readStoredDark(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const stored =
      window.localStorage.getItem(THEME_KEY) ?? window.localStorage.getItem(LEGACY_THEME_KEY) ?? "true";
    return JSON.parse(stored) as boolean;
  } catch {
    return true;
  }
}

export const ThemeProvider = memo(function ThemeProviderComp({ children }: PropsWithChildren) {
  const [isDark, setDark] = useState<boolean>(() => readStoredDark());

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(THEME_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeCtx>(() => ({ isDark, toggle }), [isDark, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
});

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return v;
}
