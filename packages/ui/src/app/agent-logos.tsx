import { memo } from "react";

/** Inline mark for tiles with no raster logo (e.g. “More via recipes”). */
export const GridRecipesLogo = memo(function GridRecipesLogoComp({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="10" fill="#1a1408" />
        <path
          d="M11 11h7v7h-7v-7zm11 0h7v7h-7v-7zm-11 11h7v7h-7v-7zm11 0h7v7h-7v-7z"
          fill="none"
          stroke="rgb(var(--highlight))"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="20" r="2.5" fill="rgb(var(--text-highlight))" opacity="0.9" />
      </svg>
    </span>
  );
});
