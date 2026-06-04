/**
 * Lightweight inline-SVG icon set.
 *
 * Each icon is a 24x24 viewbox using `currentColor` so they pick up the
 * surrounding `Text` color automatically. Add new icons by extending the
 * `ICONS` map.
 */
import { memo } from "react";

const ICONS = {
  agentsea: "M3 12l9-9 9 9-9 9zM12 3v18M3 12h18",
  list: "M4 6h16M4 12h16M4 18h16",
  plus: "M12 5v14M5 12h14",
  cross: "M6 6l12 12M18 6L6 18",
  check: "M5 12l4 4L19 7",
  refresh: "M21 12a9 9 0 1 1-3.5-7.07M21 4v6h-6",
  arrowRight: "M5 12h14M13 5l7 7-7 7",
  arrowLeft: "M19 12H5M11 19l-7-7 7-7",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM21 21l-5-5",
  bolt: "M13 3L4 14h7l-1 7 9-11h-7z",
  cloud: "M7 17h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1.5A4 4 0 0 0 7 17z",
  recipe: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h4",
  webhook: "M12 5a4 4 0 0 1 4 4M8 14a4 4 0 0 1 4-4M16 14a4 4 0 0 1-4 4",
  billing: "M3 7h18v10H3zM3 11h18M7 15h4",
  settings:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 1-.1 1.2l2 1.5-2 3.4-2.4-1a7 7 0 0 1-2 1.2l-.4 2.5h-4l-.4-2.5a7 7 0 0 1-2-1.2l-2.4 1-2-3.4 2-1.5A7 7 0 0 1 5 12c0-.4 0-.8.1-1.2l-2-1.5 2-3.4 2.4 1a7 7 0 0 1 2-1.2l.4-2.5h4l.4 2.5a7 7 0 0 1 2 1.2l2.4-1 2 3.4-2 1.5c.1.4.1.8.1 1.2z",
  workspace: "M3 7h18v12H3zM3 7l3-4h12l3 4M9 11h6",
  terminal: "M4 4h16v16H4zM7 9l3 3-3 3M13 15h4",
  logs: "M4 4h16v16H4zM4 8h16M8 12h8M8 16h6",
  cost: "M12 6v12M9 9h6a2 2 0 0 1 0 4H9a2 2 0 0 0 0 4h6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  pause: "M9 4h2v16H9zM13 4h2v16h-2z",
  play: "M5 4l14 8-14 8z",
  trash: "M5 7h14M9 7V4h6v3M7 7v13h10V7M11 11v6M13 11v6",
  rotate: "M21 12A9 9 0 1 1 6.4 5.6M21 4v6h-6",
  copy: "M9 9h11v11H9zM5 15V4h11v3",
  external: "M14 4h6v6M20 4l-9 9M20 14v6H4V4h6",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  alert: "M12 4l10 16H2zM12 11v4M12 18.01v.01",
  sun: "M12 4v2M12 18v2M4 12H2M22 12h-2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
  moon: "M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z",
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  icon: IconName;
  size?: "xs" | "s" | "m" | "l";
  className?: string;
}

const SIZE_PX: Record<NonNullable<IconProps["size"]>, number> = {
  xs: 12,
  s: 16,
  m: 20,
  l: 24,
};

export const Icon = memo(function IconComp({ icon, size = "s", className }: IconProps) {
  const px = SIZE_PX[size];
  return (
    <svg
      className={className}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[icon]} />
    </svg>
  );
});
