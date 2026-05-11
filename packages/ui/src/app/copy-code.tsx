"use client";

import { memo, useCallback, useState } from "react";

import styles from "./copy-code.module.scss";

interface CopyCodeProps {
  label?: string;
  code: string;
}

export const CopyCode = memo(function CopyCodeComp({ label = "shell", code }: CopyCodeProps) {
  const [done, setDone] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(code.trim()).then(() => {
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    });
  }, [code]);

  return (
    <div className={styles["block"]}>
      <div className={styles["toolbar"]}>
        <span className={styles["lang"]}>{label}</span>
        <button type="button" className={styles["copy"]} onClick={copy}>
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={styles["pre"]}>
        <code>{code}</code>
      </pre>
    </div>
  );
});
