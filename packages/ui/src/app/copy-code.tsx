"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";

import { writeClipboard } from "./clipboard";
import styles from "./copy-code.module.scss";

interface CopyCodeProps {
  label?: string;
  code: string;
}

type CopyState = "idle" | "copied" | "failed";

export const CopyCode = memo(function CopyCodeComp({ label = "shell", code }: CopyCodeProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timeoutRef = useRef<number | null>(null);

  // Cancel any pending reset on unmount or when a new click reschedules.
  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const copy = useCallback(() => {
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    writeClipboard(code.trim())
      .then(() => {
        setState("copied");
        timeoutRef.current = window.setTimeout(() => setState("idle"), 2000);
      })
      .catch(() => {
        setState("failed");
        timeoutRef.current = window.setTimeout(() => setState("idle"), 2500);
      });
  }, [code]);

  const label2 = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";

  return (
    <div className={styles["block"]}>
      <div className={styles["toolbar"]}>
        <span className={styles["lang"]}>{label}</span>
        <button type="button" className={styles["copy"]} onClick={copy} aria-live="polite">
          {label2}
        </button>
      </div>
      <pre className={styles["pre"]}>
        <code>{code}</code>
      </pre>
    </div>
  );
});
