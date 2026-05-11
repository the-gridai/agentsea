"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

interface ThemeCtx {
  readonly isDark: boolean;
  readonly toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function readStoredDark(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return JSON.parse(window.localStorage.getItem("grid-spawn-theme") ?? "true") as boolean;
  } catch {
    return true;
  }
}

export const ThemeProvider = memo(function ThemeProviderComp({ children }: PropsWithChildren) {
  const [isDark, setDark] = useState<boolean>(true);

  useEffect(() => {
    setDark(readStoredDark());
  }, []);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("grid-spawn-theme", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeCtx>(() => ({ isDark, toggle }), [isDark, toggle]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
});

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return v;
}



