import type { Metadata } from "next";
import { Geist, Fraunces, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import "../index.css";
import Providers from "@/components/providers";
import { PostHogProvider } from "@/components/posthog-provider";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";

const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  style: ["normal", "italic"],
});

const TITLE = "GitTerm · Open-source cloud workspaces for coding agents";
const DESCRIPTION =
  "Run coding agents in persistent cloud workspaces you control. Open source, self-hostable, bring your own model keys. Works on E2B, Daytona, Railway, AWS, or Cloudflare.";

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
        url: "/og-card/og-card.png",
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
    images: ["/og-card/og-card.png"],
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
      <body className={`${geist.variable} ${jetbrains.variable} ${fraunces.variable} antialiased`}>
        <Providers>{children}</Providers>
        <Suspense fallback={null}>
          <PostHogProvider />
        </Suspense>
        <CookieConsentBanner />
      </body>
    </html>
  );
}
