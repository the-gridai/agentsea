import { type CSSProperties, type ElementType, memo, type ReactNode } from "react";

import { BEM, toModifiers } from "@/ui/utils/bem";

import styles from "./index.module.scss";

export type TextStyle =
  | "header-1"
  | "header-2"
  | "header-3"
  | "display-l"
  | "display"
  | "display-s"
  | "text-l"
  | "text-m"
  | "text-s"
  | "text-xs"
  | "mono-l"
  | "mono-m"
  | "mono-s";

export type TextWeight = "regular" | "semi" | "bold";

export type TextColor =
  | "text"
  | "neutral"
  | "heavy"
  | "highlight"
  | "accent"
  | "positive"
  | "negative"
  | "warning"
  | "inverse";

interface TextProps {
  as?: ElementType;
  type?: TextStyle;
  weight?: TextWeight;
  color?: TextColor;
  uppercase?: boolean;
  ellipsis?: boolean;
  nowrap?: boolean;
  mono?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: () => void;
  htmlFor?: string;
  title?: string;
}

const COLOR_VAR: Record<TextColor, string> = {
  text: "--text",
  neutral: "--text-neutral",
  heavy: "--text-heavy",
  highlight: "--text-highlight",
  accent: "--text-accent",
  positive: "--text-positive",
  negative: "--text-negative",
  warning: "--warning",
  inverse: "--text-inverse",
};

const b = BEM("text", styles);

export const Text = memo(function TextComp({
  as: Tag = "span",
  type = "text-m",
  weight,
  color,
  uppercase,
  ellipsis,
  nowrap,
  mono,
  className,
  style,
  children,
  ...rest
}: TextProps) {
  const colorStyle = color ? { ...style, color: `rgb(var(${COLOR_VAR[color]}))` } : style;
  const cls = b({
    uppercase,
    ellipsis,
    nowrap,
    mono,
    ...toModifiers([type, weight]),
  });
  return (
    <Tag {...rest} style={colorStyle} className={cls.extend({ className })}>
      {children}
    </Tag>
  );
});
