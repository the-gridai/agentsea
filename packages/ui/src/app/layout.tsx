import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { Providers } from "./providers";

import "@/styles/_body.scss";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-dm-sans",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
});

export const metadata: Metadata = {
  title: "Grid Spawn — AI agents on any cloud | The Grid",
  description:
    "Pick an agent, pick a cloud, one CLI. Provision VMs, Grid API key, browser terminal — Grid Spawn for The Grid.",
  icons: {
    icon: "/thegrid-mark.svg",
  },
  openGraph: {
    title: "Grid Spawn — AI agents on any cloud",
    description: "Pick an agent, pick a cloud, one CLI. Provision VMs wired to The Grid API.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var dark = JSON.parse(localStorage.getItem('grid-spawn-theme') ?? 'true');
                document.firstElementChild.classList.toggle('dark', !!dark);
              } catch (e) {
                document.firstElementChild.classList.add('dark');
              }
            `,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
