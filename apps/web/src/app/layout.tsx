import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Space_Mono } from "next/font/google";
import "../index.css";
import Providers from "@/components/providers";

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "GitTerm — Cloud workspaces for OpenCode",
  description:
    "Launch OpenCode in seconds. Secure, stateful workspaces accessible from any device.",
  metadataBase: new URL("https://gitterm.dev"),
  openGraph: {
    title: "GitTerm — Cloud workspaces for OpenCode",
    description:
      "Launch OpenCode in seconds. Secure, stateful workspaces accessible from any device.",
    url: "https://gitterm.dev",
    siteName: "GitTerm",
    images: [
      {
        url: "/og-card/og-card-reduced.jpg",
        width: 1200,
        height: 630,
        alt: "GitTerm — Cloud workspaces for OpenCode",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitTerm — Cloud workspaces for OpenCode",
    description:
      "Launch OpenCode in seconds. Secure, stateful workspaces accessible from any device.",
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
      <body className={`${dmSans.variable} ${spaceMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
