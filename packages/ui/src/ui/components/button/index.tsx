import { type ButtonHTMLAttributes, type ElementType, type ReactNode, memo } from "react";

import { BEM, toModifiers } from "@/ui/utils/bem";

import styles from "./index.module.scss";

export type ButtonVariant = "highlight" | "accent" | "secondary" | "ghost" | "positive" | "negative" | "alt";
export type ButtonSize = "xs" | "s" | "m" | "l";

interface ButtonOwnProps {
  as?: ElementType;
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  grow?: boolean;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  active?: boolean;
  href?: string;
  /** Render with no inner padding (icon-only button). */
  onlyIcon?: boolean;
}

type ButtonProps = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement>;

const b = BEM("button", styles);

export const Button = memo(function ButtonComp({
  as,
  variant = "highlight",
  size = "m",
  full,
  grow,
  loading,
  iconLeft,
  iconRight,
  active,
  onlyIcon,
  children,
  className,
  ...rest
}: ButtonProps) {
  const Tag = (as ?? "button") as ElementType;
  const cls = b({
    full,
    grow,
    loading,
    active,
    "icon-only": onlyIcon,
    ...toModifiers([variant, size]),
  });
  return (
    <Tag
      {...rest}
      className={cls.extend({ className })}
      disabled={loading || (rest as ButtonHTMLAttributes<HTMLButtonElement>).disabled}
    >
      {iconLeft && <span className={styles["button__icon"]}>{iconLeft}</span>}
      {!onlyIcon && children !== undefined && <span className={styles["button__label"]}>{children}</span>}
      {onlyIcon && children}
      {iconRight && <span className={styles["button__icon"]}>{iconRight}</span>}
    </Tag>
  );
});
