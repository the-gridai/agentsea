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
    >
      <Icon icon={isDark ? "sun" : "moon"} size="s" />
    </button>
  );
});
