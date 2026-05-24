import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { EnterpriseContent } from "@/components/landing/enterprise/content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GitTerm · Enterprise",
  description:
    "Bring agentic coding inside your VPC. Your cloud, your keys, your policies. Self-hosted GitTerm for teams.",
};

export default function EnterprisePage() {
  return (
    <main className="min-h-screen bg-background text-white dark landing-grid grain">
      <LandingHeader />
      <EnterpriseContent />
      <Footer />
    </main>
  );
}
