import { memo } from "react";

import styles from "./index.module.scss";

/** Mark from `https://app.thegrid.ai/assets/icon.svg` (icon portion only, `currentColor`). */
function TheGridMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-0.2 -0.2 18.9 20.4" fill="none" aria-hidden>
      <path d="M0.000150681 0L4.33724 3.78339V5.94533H0.000150681V0Z" fill="currentColor" />
      <path d="M0 20L4.33709 16.2166V14.0547H0V20Z" fill="currentColor" />
      <path d="M18.4325 0L14.0954 3.78339V5.94533H18.4325V0Z" fill="currentColor" />
      <path d="M18.4325 20L14.0954 16.2166V14.0547H18.4325V20Z" fill="currentColor" />
      <path d="M5.9636 0L8.13214 3.78341V5.94533H5.9636V0Z" fill="currentColor" />
      <path d="M5.9636 20L8.13214 16.2166V14.0547H5.9636V20Z" fill="currentColor" />
      <path d="M12.4692 0L10.3007 3.78341V5.94533H12.4692V0Z" fill="currentColor" />
      <path d="M12.4692 20L10.3007 16.2166V14.0547H12.4692V20Z" fill="currentColor" />
      <path d="M0 6.21701L4.33709 8.37895V11.6219L0 13.7838V12.2948V8.62774V6.21701Z" fill="currentColor" />
      <path d="M5.9636 6.217L8.13214 8.37894V11.6219L5.9636 13.7838V12.2948V8.62773V6.217Z" fill="currentColor" />
      <path d="M12.4692 6.217L10.3007 8.37894V11.6219L12.4692 13.7838V12.2948V8.62773V6.217Z" fill="currentColor" />
      <path d="M18.4325 6.21701L14.0954 8.37895V11.6219L18.4325 13.7838V12.2948V8.62774V6.21701Z" fill="currentColor" />
    </svg>
  );
}

interface LogoProps {
  size?: "s" | "m" | "l";
  variant?: "full" | "mark";
  className?: string;
}

export const Logo = memo(function LogoComp({ size = "m", variant = "full", className }: LogoProps) {
  return (
    <span className={`${styles["logo"]} ${styles[`logo--${size}`]} ${className ?? ""}`.trim()}>
      <TheGridMark className={styles["logo__mark"]} />
      {variant === "full" && (
        <span className={styles["logo__word"]}>
          grid<span className={styles["logo__word-spawn"]}>spawn</span>
        </span>
      )}
    </span>
  );
});
