import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { BEM } from "@/ui/utils/bem";

import styles from "./index.module.scss";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  size?: "s" | "m";
  monospace?: boolean;
}

const b = BEM("input", styles);

export const Input = forwardRef<HTMLInputElement, InputProps>(function InputComp(
  { label, hint, error, iconLeft, iconRight, size = "m", monospace, className, ...rest },
  ref,
) {
  return (
    <label className={b({ [`size-${size}`]: true, error: !!error, monospace }).extend({ className })}>
      {label && <span className={styles["input__label"]}>{label}</span>}
      <span className={styles["input__field"]}>
        {iconLeft && <span className={styles["input__icon"]}>{iconLeft}</span>}
        <input ref={ref} {...rest} className={styles["input__el"]} />
        {iconRight && <span className={styles["input__icon"]}>{iconRight}</span>}
      </span>
      {(hint || error) && <span className={styles["input__hint"]}>{error ?? hint}</span>}
    </label>
  );
});
