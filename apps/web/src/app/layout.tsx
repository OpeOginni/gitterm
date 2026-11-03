import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import "../index.css";
import Providers from "@/components/providers";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";

/*
 * Type: Hubot Sans (wide) for headlines, Martian Grotesk for text, Martian Mono for code.
 * Each face carries a fixed width and a size-adjust so the site's px sizes keep the line
 * lengths they had with Geist and JetBrains Mono (Martian runs ~25% wider at the same size).
 */
const text = localFont({
  src: "../fonts/MartianGrotesk.woff2",
  variable: "--font-sans",
  weight: "100 900",
  declarations: [
    { prop: "font-stretch", value: "93%" },
    { prop: "size-adjust", value: "86%" },
  ],
});

const mono = localFont({
  src: "../fonts/MartianMono.woff2",
  variable: "--font-mono",
  weight: "100 800",
  declarations: [
    { prop: "font-stretch", value: "87.5%" },
    { prop: "size-adjust", value: "92%" },
  ],
});

const display = localFont({
  src: "../fonts/HubotSans.woff2",
  variable: "--font-display",
  weight: "200 900",
  declarations: [
    { prop: "font-stretch", value: "125%" },
    { prop: "size-adjust", value: "86%" },
  ],
});

const TITLE = "GitTerm · Cloud workspaces for coding agents";
const DESCRIPTION =
  "Cloud workspaces for coding agents. Heavy runs, temporary sandboxes, any cloud. Your keys. Open source.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL("https://gitterm.dev"),
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://gitterm.dev",
    siteName: "GitTerm",
    images: [
      {
        url: "/og-card/og-card-v4.png",
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-card/og-card-v4.png"],
  },
  manifest: "/favicon_io/site.webmanifest",
  icons: {
    icon: [
      {
        url: "/favicon_io/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/favicon_io/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
    ],
    apple: [{ url: "/favicon_io/apple-touch-icon.png" }],
    shortcut: "/favicon_io/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${text.variable} ${mono.variable} ${display.variable} antialiased`}>
        <Providers>{children}</Providers>
        <Suspense fallback={null}>
          <AnalyticsProvider />
        </Suspense>
        <CookieConsentBanner />
      </body>
    </html>
  );
}
