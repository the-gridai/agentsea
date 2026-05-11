import { memo, type PropsWithChildren, type ReactNode } from "react";

import { BEM } from "@/ui/utils/bem";

import styles from "./index.module.scss";

export type TagVariant = "neutral" | "highlight" | "accent" | "positive" | "negative" | "warning" | "info";

interface TagProps {
  variant?: TagVariant;
  size?: "s" | "m";
  icon?: ReactNode;
  className?: string;
}

const b = BEM("tag", styles);

export const Tag = memo(function TagComp({
  variant = "neutral",
  size = "m",
  icon,
  children,
  className,
}: PropsWithChildren<TagProps>) {
  return (
    <span className={b({ [`variant-${variant}`]: true, [`size-${size}`]: true }).extend({ className })}>
      {icon && <span className={styles["tag__icon"]}>{icon}</span>}
      {children}
    </span>
  );
});
