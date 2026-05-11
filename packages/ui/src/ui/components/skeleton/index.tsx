import { memo } from "react";

import styles from "./index.module.scss";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: "s" | "m" | "full";
  className?: string;
}

export const Skeleton = memo(function SkeletonComp({ width, height = 14, rounded = "s", className }: SkeletonProps) {
  return (
    <span
      className={`${styles["skeleton"]} ${styles[`skeleton--${rounded}`]} ${className ?? ""}`.trim()}
      style={{ width, height }}
    />
  );
});
