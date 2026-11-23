import { IBM_Plex_Mono, Inter } from "next/font/google";
import { SiteShell } from "@/components/site/site-shell";
import { LandingRoot } from "@/components/landing/landing-root";
import { Demo } from "@/components/landing/demo";
import {
  Agents,
  Anywhere,
  Cta,
  Desktop,
  Features,
  Hero,
  HowItWorks,
  Keys,
  ProvidersStrip,
} from "@/components/landing/sections";

// The OpenCode desktop and phone mocks use OpenCode's own type: Inter and IBM Plex Mono.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
  display: "swap",
});

export default function Home() {
  return (
    <SiteShell>
      <LandingRoot className={`${inter.variable} ${plex.variable}`}>
        <Hero />
        <ProvidersStrip />
        <Demo />
        <HowItWorks />
        <Keys />
        <Desktop />
        <Agents />
        <Anywhere />
        <Features />
        <Cta />
      </LandingRoot>
    </SiteShell>
  );
}
