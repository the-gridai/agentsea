import Image from "next/image";
import { memo } from "react";

import { DIGITALOCEAN_LOGO_PATH, LINODE_LOGO_PATH } from "./home-public-constants";

/**
 * Single source for cloud provider logos. Both the homepage Step 2 picker
 * and the /cli summary pickRow render the same set of cloud slugs; this
 * function lets them share the same switch instead of duplicating it.
 */
export function CloudLogo({
  slug,
  icon,
  size,
  imgClassName,
  svgClassName,
}: {
  slug: string;
  icon?: string | null;
  size: number;
  imgClassName?: string;
  svgClassName?: string;
}) {
  if (slug === "local") {
    return <LocalMachineLogo className={svgClassName} />;
  }
  if (slug === "digitalocean") {
    return (
      <Image
        src={DIGITALOCEAN_LOGO_PATH}
        alt=""
        width={size}
        height={size}
        className={imgClassName}
        sizes={`${size}px`}
      />
    );
  }
  if (slug === "linode") {
    return (
      <Image
        src={LINODE_LOGO_PATH}
        alt=""
        width={size}
        height={size}
        className={imgClassName}
        sizes={`${size}px`}
      />
    );
  }
  if (icon) {
    // Remote manifest icon — keep unoptimized because Next can't optimize
    // arbitrary external hosts without `remotePatterns` config.
    return (
      <Image
        src={icon}
        alt=""
        width={size}
        height={size}
        className={imgClassName}
        sizes={`${size}px`}
        unoptimized
      />
    );
  }
  return <LocalMachineLogo className={svgClassName} />;
}

/** Laptop icon for local machine provider cards. */
export const LocalMachineLogo = memo(function LocalMachineLogoComp({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="10" fill="#1a1408" />
        <rect x="9" y="11" width="22" height="14" rx="2" stroke="rgb(var(--highlight))" strokeWidth="1.8" />
        <path d="M6 28h28" stroke="rgb(var(--text-highlight))" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="20" cy="18" r="2" fill="rgb(var(--text-highlight))" opacity="0.85" />
      </svg>
    </span>
  );
});
