import { memo } from "react";

import styles from "./index.module.scss";

interface LoadingCircleProps {
  size?: "xs" | "s" | "m";
  className?: string;
}

export const LoadingCircle = memo(function LoadingCircleComp({ size = "s", className }: LoadingCircleProps) {
  return <span className={`${styles["loader"]} ${styles[`loader--${size}`]} ${className ?? ""}`.trim()} />;
});
