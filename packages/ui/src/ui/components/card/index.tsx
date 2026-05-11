import { memo, type PropsWithChildren } from "react";

import { BEM } from "@/ui/utils/bem";

import styles from "./index.module.scss";

interface CardProps {
  bordered?: boolean;
  padded?: boolean | "tight";
  variant?: "default" | "raised" | "ghost";
  className?: string;
}

const b = BEM("card", styles);

export const Card = memo(function CardComp({
  children,
  bordered = true,
  padded = true,
  variant = "default",
  className,
}: PropsWithChildren<CardProps>) {
  const cls = b({
    bordered,
    [`padded`]: padded === true,
    ["padded-tight"]: padded === "tight",
    [`variant-${variant}`]: true,
  });
  return <div className={cls.extend({ className })}>{children}</div>;
});

export const CardHeader = memo(function CardHeaderComp({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return <div className={`${styles["card__header"]} ${className ?? ""}`.trim()}>{children}</div>;
});

export const CardBody = memo(function CardBodyComp({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={`${styles["card__body"]} ${className ?? ""}`.trim()}>{children}</div>;
});

export const CardFooter = memo(function CardFooterComp({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return <div className={`${styles["card__footer"]} ${className ?? ""}`.trim()}>{children}</div>;
});
