import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { SelfHostContent } from "@/components/landing/self-host/content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GitTerm · Self-host",
  description:
    "Run GitTerm on your own infrastructure. Open source and self-hostable: your cloud, your keys, your data.",
};

export default function SelfHostPage() {
  return (
    <main className="min-h-screen bg-background text-white dark landing-grid grain">
      <LandingHeader />
      <SelfHostContent />
      <Footer />
    </main>
  );
}
