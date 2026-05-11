export interface WithClassName<T = unknown> {
  className?: string;
  children?: import("react").ReactNode;
  data?: T;
}

export type Variant = "highlight" | "accent" | "positive" | "negative" | "secondary" | "alt" | "nav" | "text";
