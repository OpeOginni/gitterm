import { HeroSection } from "@/components/landing/hero-section";
import { ProblemSection } from "@/components/landing/problem-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { CTASection } from "@/components/landing/cta-section";
import { FaqSection } from "@/components/landing/faq-section";
import { Footer } from "@/components/landing/footer";
import { LandingHeader } from "@/components/landing/header";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-white dark landing-grid grain">
      <LandingHeader />
      <HeroSection />
      <ProblemSection />
      <FeaturesSection />
      <CTASection />
      <FaqSection />
      <Footer />
    </main>
  );
}
