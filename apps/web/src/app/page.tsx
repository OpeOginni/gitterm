import { HeroSection } from "@/components/landing/hero-section";
import { ProblemSection } from "@/components/landing/problem-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { CTASection } from "@/components/landing/cta-section";
import { FaqSection } from "@/components/landing/faq-section";
import { Footer } from "@/components/landing/footer";
import { LandingHeader } from "@/components/landing/header";

export default function Home() {
  return (
    <main className="dark landing-grid grain min-h-screen w-[100dvw] max-w-[100dvw] overflow-x-clip bg-background text-white">
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
