"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";

import { writeClipboard } from "./clipboard";
import styles from "./agentsea-copy-block.module.scss";

export type AgentseaCopyBlockProps = {
  code: string;
  className?: string;
  stretch?: boolean;
  /** Larger monospace for hero deploy commands. */
  prominent?: boolean;
};

type CopyState = "idle" | "copied" | "failed";

export const AgentseaCopyBlock = memo(function AgentseaCopyBlockComp({
  code,
  className,
  stretch,
  prominent,
}: AgentseaCopyBlockProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timeoutRef = useRef<number | null>(null);

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

  const buttonLabel = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";
  const blockClassName = [
    styles["block"],
    stretch ? styles["block--stretch"] : "",
    prominent ? styles["block--prominent"] : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={blockClassName}>
      <div className={styles["shell"]}>
        <span className={styles["lang"]}>shell</span>
        <pre className={styles["pre"]}>
          <code>{code}</code>
        </pre>
      </div>
      <button type="button" className={styles["copy"]} onClick={copy} aria-live="polite">
        {buttonLabel}
      </button>
    </div>
  );
});
