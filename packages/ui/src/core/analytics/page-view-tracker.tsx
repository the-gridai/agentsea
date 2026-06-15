"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { track } from "@/core/analytics/mixpanel";

/**
 * Fires a custom `Page Viewed` event on initial load and on every client-side
 * route change.
 *
 * The property shape is kept identical to the marketing site
 * (the-grid-ai-landing-page) — `page_path`, `page_url`, `page_title`,
 * `referrer` — so a single Mixpanel funnel/report on "Page Viewed" includes the
 * website (thegrid.ai), the app (app.thegrid.ai) and agentsea (agentsea.thegrid.ai)
 * consistently. Mixpanel's built-in `$mp_web_page_view` still fires too (via
 * `track_pageview`), but the website reports on this custom name, and without
 * it agentsea would never show up in those funnels.
 *
 * App Router has no router event for completed navigations, so we derive the
 * change from `usePathname()` + `useSearchParams()`. `useSearchParams` must be
 * read under a Suspense boundary, hence the wrapper.
 */
function PageViewTrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // One event per unique URL (also guards React Strict Mode double-invoke).
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const query = searchParams?.toString();
    const fullPath = query ? `${pathname}?${query}` : pathname;
    if (lastUrl.current === fullPath) return;
    lastUrl.current = fullPath;

    track("Page Viewed", {
      page_path: pathname,
      page_url: window.location.href,
      page_title: document.title,
      referrer: document.referrer || undefined,
    });
  }, [pathname, searchParams]);

  return null;
}

export function PageViewTracker() {
  return (
    <Suspense fallback={null}>
      <PageViewTrackerInner />
    </Suspense>
  );
}
