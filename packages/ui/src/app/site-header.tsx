"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo } from "react";

import { Logo } from "@/ui/components/logo";
import { ThemeSwitch } from "@/ui/components/theme-switch";

import styles from "./site-header.module.scss";

export const SiteHeader = memo(function SiteHeaderComp() {
  const pathname = usePathname();
  // /cli with no params shows the reference; /cli?agent=&cloud= shows the
  // launch view. Treat both as the same nav target for `aria-current`.
  const onCli = pathname?.startsWith("/cli") ?? false;
  return (
    <header className={styles["header"]}>
      <div className={styles["inner"]}>
        <Link href="/" className={styles["brand"]}>
          <Logo size="s" />
        </Link>
        <nav className={styles["nav"]} aria-label="Primary">
          <Link
            href="/cli"
            className={[styles["nav__link"], onCli ? styles["nav__link--active"] : ""].filter(Boolean).join(" ")}
            aria-current={onCli ? "page" : undefined}
          >
            CLI guide
          </Link>
          <ThemeSwitch />
        </nav>
      </div>
    </header>
  );
});
