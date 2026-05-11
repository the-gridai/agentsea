import { memo } from "react";

import styles from "./index.module.scss";

interface DividerProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export const Divider = memo(function DividerComp({ orientation = "horizontal", className }: DividerProps) {
  return <div className={`${styles["divider"]} ${styles[`divider--${orientation}`]} ${className ?? ""}`.trim()} />;
});
