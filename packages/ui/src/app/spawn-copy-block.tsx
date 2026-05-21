"use client";

import { memo, useCallback, useState } from "react";

import styles from "./spawn-copy-block.module.scss";

export type SpawnCopyBlockProps = {
  code: string;
};

export const SpawnCopyBlock = memo(function SpawnCopyBlockComp({ code }: SpawnCopyBlockProps) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(code.trim()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className={styles["block"]}>
      <div className={styles["shell"]}>
        <span className={styles["lang"]}>shell</span>
        <pre className={styles["pre"]}>
          <code>{code}</code>
        </pre>
      </div>
      <button type="button" className={styles["copy"]} onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
});
