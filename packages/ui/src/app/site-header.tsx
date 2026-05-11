"use client";

import Link from "next/link";
import { memo } from "react";

import { Logo } from "@/ui/components/logo";
import { ThemeSwitch } from "@/ui/components/theme-switch";

import styles from "./site-header.module.scss";

export const SiteHeader = memo(function SiteHeaderComp() {
  return (
    <header className={styles["header"]}>
      <div className={styles["inner"]}>
        <Link href="/" className={styles["brand"]}>
          <Logo size="s" />
        </Link>
        <nav className={styles["nav"]} aria-label="Primary">
          <Link href="/cli" className={styles["nav__link"]}>
            CLI guide
          </Link>
          <ThemeSwitch />
        </nav>
      </div>
    </header>
  );
});
