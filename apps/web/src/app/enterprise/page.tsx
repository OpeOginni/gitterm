import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { EnterpriseContent } from "@/components/landing/enterprise/content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Enterprise — GitTerm",
  description:
    "We'll help you set up GitTerm on your own infrastructure. Reach out and we'll get you running.",
};

export default function EnterprisePage() {
  return (
    <main className="min-h-screen bg-[#09090b] text-white dark landing-grid">
      <LandingHeader />
      <EnterpriseContent />
      <Footer />
    </main>
  );
}
