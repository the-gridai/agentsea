"use client";

import { memo } from "react";

import { useTheme } from "@/app/theme-provider";
import { Icon } from "@/ui/components/icon";

import styles from "./index.module.scss";

export const ThemeSwitch = memo(function ThemeSwitchComp({ className }: { className?: string }) {
  const { isDark, toggle } = useTheme();
  return (
    <button
      type="button"
      className={`${styles["switch"]} ${className ?? ""}`.trim()}
      onClick={() => toggle()}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      suppressHydrationWarning
    >
      {/* The icon depends on the stored theme; the inline boot script applies
          the right body class before hydration, but this React subtree only
          knows the real value on the client, so the first paint may differ
          from the SSR output. We suppress the warning rather than render a
          neutral placeholder (which would cause its own flash). */}
      <span suppressHydrationWarning>
        <Icon icon={isDark ? "sun" : "moon"} size="s" />
      </span>
    </button>
  );
});
