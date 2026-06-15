"use client";

import { useState, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ThemeProvider } from "@/app/theme-provider";
import { PageViewTracker } from "@/core/analytics/page-view-tracker";

export const Providers = ({ children }: PropsWithChildren) => {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <PageViewTracker />
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
};
