"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo } from "react";

import { Logo } from "@/ui/components/logo";
import { ThemeSwitch } from "@/ui/components/theme-switch";

import styles from "./site-header.module.scss";

const NAV_LINKS = [
  { href: "/cli", label: "CLI Reference" },
  { href: "/why-agentsea", label: "Why AgentSea" },
  { href: "/how-it-works", label: "How it works" },
] as const;

export const SiteHeader = memo(function SiteHeaderComp() {
  const pathname = usePathname();

  return (
    <header className={styles["header"]}>
      <div className={styles["inner"]}>
        <Link href="/" className={styles["brand"]}>
          <Logo size="s" />
        </Link>
        <nav className={styles["nav"]} aria-label="Primary">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={[styles["nav__link"], active ? styles["nav__link--active"] : ""].filter(Boolean).join(" ")}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
          <ThemeSwitch />
        </nav>
      </div>
    </header>
  );
});
