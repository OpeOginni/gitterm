import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";

export const metadata: Metadata = {
  title: "GitTerm· Terms of Service",
  description: "The terms that govern your use of the GitTerm hosted service.",
};

const LAST_UPDATED = "May 26, 2026";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-white">
      <LandingHeader />
      <main className="mx-auto max-w-[760px] px-4 pt-24 pb-14 sm:px-6 sm:pt-32 sm:pb-20">
        <header className="border-b border-white/[0.06] pb-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary/80">Legal</p>
          <h1 className="mt-3 font-serif text-4xl font-medium tracking-tight text-white sm:text-5xl">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-white/45">Last updated {LAST_UPDATED}</p>
        </header>

        <article className="mt-10 space-y-10 text-[15px] leading-relaxed text-white/75">
          <Section title="1. Agreement">
            <p>
              These Terms of Service ("Terms") govern your access to and use of the hosted GitTerm
              service ("Service") at gitterm.dev. By creating an account or using the Service you
              agree to these Terms. If you do not agree, do not use the Service.
            </p>
            <p>
              The self-hostable GitTerm software is licensed separately under its open-source
              license; these Terms apply only to the hosted service.
            </p>
          </Section>

          <Section title="2. Eligibility & account">
            <p>
              You must be at least 13 years old (or the minimum age of digital consent in your
              jurisdiction) to use the Service. You are responsible for keeping your credentials
              secure and for all activity under your account. Notify us immediately at{" "}
              <a className="text-primary underline" href="mailto:help@gitterm.dev">
                help@gitterm.dev
              </a>{" "}
              if you suspect unauthorized access.
            </p>
          </Section>

          <Section title="3. Plans, billing & refunds">
            <ul className="list-disc space-y-2 pl-5 marker:text-white/30">
              <li>
                Paid plans are billed in advance on a recurring basis through our payments
                processor. By subscribing you authorize recurring charges until you cancel.
              </li>
              <li>
                You can cancel at any time from the dashboard. Cancellation stops future renewals;
                we do not pro-rate refunds for unused time except where required by law.
              </li>
              <li>
                Plan limits (workspaces, runtime minutes, etc.) are described on the pricing page
                and may change with reasonable notice.
              </li>
            </ul>
          </Section>

          <Section title="4. Acceptable use">
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc space-y-2 pl-5 marker:text-white/30">
              <li>break the law or infringe third-party rights;</li>
              <li>
                run cryptocurrency miners, botnets, denial-of-service tooling, spam infrastructure,
                or other abusive workloads;
              </li>
              <li>
                store or process malware, child sexual abuse material, or content that incites
                violence;
              </li>
              <li>
                attempt to bypass quotas, probe our infrastructure, or interfere with other users;
              </li>
              <li>resell, sublicense, or repackage the Service without our written permission.</li>
            </ul>
            <p>
              We may suspend or terminate accounts that violate these rules, with or without notice
              depending on severity.
            </p>
          </Section>

          <Section title="5. Your content">
            <p>
              You retain all rights to the code, files, and other content you upload to or generate
              within your workspaces ("Your Content"). You grant us a limited license to host,
              store, transmit, back up, and display Your Content solely as needed to provide the
              Service.
            </p>
            <p>
              You are solely responsible for Your Content and for complying with the licenses of any
              third-party code you use.
            </p>
          </Section>

          <Section title="6. Third-party services & API keys">
            <p>
              The Service can connect to third-party providers (such as model providers, GitHub, and
              your own API keys). Your use of those providers is governed by their own terms. Keys
              you bring are stored encrypted and used only to fulfill requests you initiate.
            </p>
          </Section>

          <Section title="7. Service availability">
            <p>
              We work hard to keep the Service available but provide it on an "as is" and "as
              available" basis. We may need to perform planned maintenance, deploy fixes, or modify
              features. We will give reasonable notice for changes that materially reduce
              functionality of paid plans.
            </p>
          </Section>

          <Section title="8. Suspension and termination">
            <p>
              You may stop using the Service or delete your account at any time from the dashboard.
              We may suspend or terminate your access if you breach these Terms, if your use creates
              risk or legal exposure for us, or if your account is inactive for an extended period.
              Upon termination, your data will be deleted in accordance with our Privacy Policy.
            </p>
          </Section>

          <Section title="9. Disclaimers">
            <p>
              To the maximum extent permitted by law, the Service is provided "as is" without
              warranties of any kind, whether express, implied, statutory, or otherwise, including
              warranties of merchantability, fitness for a particular purpose, title, and
              non-infringement. We do not warrant that the Service will be uninterrupted, secure, or
              error-free, or that any data will not be lost or corrupted.
            </p>
          </Section>

          <Section title="10. Limitation of liability">
            <p>
              To the maximum extent permitted by law, in no event will GitTerm, its maintainers,
              contributors, or processors be liable for any indirect, incidental, special,
              consequential, or punitive damages, or any loss of profits, revenues, data, or
              goodwill arising out of or relating to your use of the Service. Our aggregate
              liability for direct damages is limited to the amount you paid us for the Service in
              the twelve (12) months preceding the claim, or US$100 if you are on a free plan.
            </p>
          </Section>

          <Section title="11. Indemnity">
            <p>
              You will indemnify and hold harmless GitTerm and its maintainers from any claim,
              demand, or damages arising out of Your Content, your use of the Service, or your
              violation of these Terms or applicable law.
            </p>
          </Section>

          <Section title="12. Changes to the Terms">
            <p>
              We may update these Terms from time to time. If we make material changes we will
              notify you (for example, by email or an in-app notice) before they take effect.
              Continuing to use the Service after changes take effect means you accept the updated
              Terms.
            </p>
          </Section>

          <Section title="13. Governing law & disputes">
            <p>
              These Terms are governed by the laws of the jurisdiction in which the GitTerm
              operating entity is established, without regard to conflict-of-laws principles.
              Disputes will be resolved in the courts of that jurisdiction, except where applicable
              law requires otherwise.
            </p>
          </Section>

          <Section title="14. Contact">
            <p>
              Questions about these Terms? Email{" "}
              <a className="text-primary underline" href="mailto:help@gitterm.dev">
                help@gitterm.dev
              </a>
              .
            </p>
          </Section>
        </article>
      </main>
      <Footer />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-serif text-2xl font-medium text-white">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
