import { HeroSection } from "@/components/landing/hero-section";
import { MirrorLocalSection } from "@/components/landing/mirror-local-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { CTASection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { LandingHeader } from "@/components/landing/header";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#09090b] text-white dark landing-grid">
      <LandingHeader />
      <HeroSection />
      <FeaturesSection />
      <MirrorLocalSection />
      <HowItWorksSection />
      <CTASection />
      <Footer />
    </main>
  );
}
