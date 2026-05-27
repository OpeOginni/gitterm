import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";

export const metadata: Metadata = {
  title: "GitTerm · Privacy Policy ",
  description:
    "How GitTerm collects, uses, and protects your data, including cookies, analytics, and authentication.",
};

const LAST_UPDATED = "May 26, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-white">
      <LandingHeader />
      <main className="mx-auto max-w-[760px] px-4 pt-24 pb-14 sm:px-6 sm:pt-32 sm:pb-20">
        <header className="border-b border-white/[0.06] pb-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary/80">
            Legal
          </p>
          <h1 className="mt-3 font-serif text-4xl font-medium tracking-tight text-white sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-white/45">Last updated {LAST_UPDATED}</p>
        </header>

        <article className="prose-policy mt-10 space-y-10 text-[15px] leading-relaxed text-white/75">
          <section className="space-y-3">
            <p>
              This Privacy Policy explains what information GitTerm ("GitTerm", "we",
              "us") collects when you use the hosted GitTerm service at gitterm.dev,
              how we use it, and the choices you have. If you self-host GitTerm,
              this policy does not apply. You are the data controller for your own
              instance.
            </p>
          </section>

          <Section title="1. Who we are">
            <p>
              GitTerm provides cloud workspaces for running coding agents. The
              hosted service is operated by the GitTerm maintainers. You can reach
              us at{" "}
              <a className="text-primary underline" href="mailto:help@gitterm.dev">
                help@gitterm.dev
              </a>
              .
            </p>
          </Section>

          <Section title="2. Information we collect">
            <ul className="list-disc space-y-2 pl-5 marker:text-white/30">
              <li>
                <strong className="text-white/90">Account data.</strong> When you sign
                up we receive your email address and, if you sign in with GitHub, your
                GitHub username and avatar. We store a hashed identifier so we can
                recognize you on return visits.
              </li>
              <li>
                <strong className="text-white/90">Workspace data.</strong> The Git
                repositories, files, and command history inside your workspaces are
                stored on infrastructure we operate so that we can deliver the
                service. We treat this content as confidential and only access it
                when required to operate, secure, or debug the service.
              </li>
              <li>
                <strong className="text-white/90">Billing data.</strong> If you
                subscribe to a paid plan, payment is processed by our payments
                provider. We receive a customer identifier and subscription status.
                We do not receive or store your full card details.
              </li>
              <li>
                <strong className="text-white/90">Product analytics.</strong> If you
                consent, we record anonymous events (such as page views and feature
                clicks) so we can understand how the product is used. See section 4.
              </li>
              <li>
                <strong className="text-white/90">Logs.</strong> Our servers
                automatically log requests (IP address, user agent, timestamp,
                request path, status code) for security and operational purposes.
                These logs are retained for a limited period.
              </li>
            </ul>
          </Section>

          <Section title="3. How we use your information">
            <ul className="list-disc space-y-2 pl-5 marker:text-white/30">
              <li>To provide, secure, and operate the GitTerm service.</li>
              <li>To authenticate you and keep your session active across devices.</li>
              <li>To process payments and manage your subscription.</li>
              <li>
                To communicate service-critical messages (e.g. account, billing,
                security).
              </li>
              <li>
                To improve the product through aggregate, anonymous usage analytics,
                but only with your consent.
              </li>
              <li>To comply with legal obligations.</li>
            </ul>
            <p>
              We do <strong className="text-white/90">not</strong> sell your personal
              data, and we do not run advertising on GitTerm.
            </p>
          </Section>

          <Section title="4. Cookies and similar technologies">
            <p>
              We use a small number of cookies. They fall into two categories:
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-white/[0.06]">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <thead className="bg-white/[0.03] font-mono text-[11px] uppercase tracking-wider text-white/50">
                  <tr>
                    <th className="px-3 py-2.5">Cookie</th>
                    <th className="px-3 py-2.5">Purpose</th>
                    <th className="px-3 py-2.5">Category</th>
                  </tr>
                </thead>
                <tbody className="text-white/70">
                  <Row
                    name="Session cookie"
                    purpose="Keeps you signed in. Set by our authentication system; HTTP-only and secure."
                    category="Necessary"
                  />
                  <Row
                    name="Anonymous workspace token"
                    purpose="Short-lived (10 minutes). Lets visitors try a workspace without signing up."
                    category="Necessary"
                  />
                  <Row
                    name="UI preferences"
                    purpose="Remembers small UI state such as sidebar open/closed."
                    category="Necessary"
                  />
                  <Row
                    name="gitterm_consent"
                    purpose="Stores your cookie consent choice for one year."
                    category="Necessary"
                  />
                  <Row
                    name="Analytics cookies"
                    purpose="Set only if you accept analytics. Track anonymous product usage."
                    category="Optional"
                  />
                </tbody>
              </table>
            </div>
            <p className="mt-3">
              You can change your choice at any time from{" "}
              <strong className="text-white/90">Settings → Privacy</strong> in the
              dashboard, or by clearing the <code>gitterm_consent</code> cookie.
            </p>
          </Section>

          <Section title="5. Analytics">
            <p>
              When enabled, our analytics provider sets cookies and processes
              pseudonymous usage data on our behalf. We have configured it to:
            </p>
            <ul className="list-disc space-y-2 pl-5 marker:text-white/30">
              <li>only create user profiles for signed-in users,</li>
              <li>not auto-capture form inputs or session recordings,</li>
              <li>only run when you have given consent.</li>
            </ul>
            <p>
              If you reject analytics, we do not initialize the analytics SDK and
              no analytics events are sent from your browser.
            </p>
          </Section>

          <Section title="6. Sharing and processors">
            <p>
              We share data only with vetted processors who help us run GitTerm.
              These include cloud hosting and compute providers, our database and
              cache providers, our authentication system, our payments processor,
              our email provider, and our analytics provider if you consent.
              Each processor is bound by a data processing agreement and may only
              use your data to provide services to us.
            </p>
            <p>
              We may disclose information if required to do so by law, to protect
              our rights, or to protect the safety of our users.
            </p>
          </Section>

          <Section title="7. Data retention">
            <p>
              Account data is retained while your account is active. If you delete
              your account from <strong className="text-white/90">Settings →
              Account</strong>, we delete your account record, your workspaces,
              and associated metadata within 30 days, except where retention is
              required for legal, accounting, or fraud-prevention purposes. Server
              logs are retained for a limited operational period.
            </p>
          </Section>

          <Section title="8. International transfers">
            <p>
              Our infrastructure may process data in regions outside your country
              of residence. Where required, we rely on appropriate safeguards
              (such as Standard Contractual Clauses) for international transfers.
            </p>
          </Section>

          <Section title="9. Your rights">
            <p>
              Depending on where you live (e.g. EEA, UK, California), you may have
              the right to:
            </p>
            <ul className="list-disc space-y-2 pl-5 marker:text-white/30">
              <li>access the personal data we hold about you,</li>
              <li>correct inaccurate data,</li>
              <li>delete your account and associated data,</li>
              <li>object to or restrict certain processing,</li>
              <li>withdraw consent for analytics at any time,</li>
              <li>port your data to another service,</li>
              <li>lodge a complaint with your local data protection authority.</li>
            </ul>
            <p>
              You can exercise most of these rights directly from the dashboard or
              by emailing{" "}
              <a className="text-primary underline" href="mailto:help@gitterm.dev">
                help@gitterm.dev
              </a>
              .
            </p>
          </Section>

          <Section title="10. Security">
            <p>
              We use industry-standard measures including TLS in transit,
              encryption at rest where supported, scoped access controls, and
              regular dependency updates. No system is perfectly secure. Please
              report suspected vulnerabilities to{" "}
              <a className="text-primary underline" href="mailto:help@gitterm.dev">
                help@gitterm.dev
              </a>
              .
            </p>
          </Section>

          <Section title="11. Children">
            <p>
              GitTerm is not directed to children under 13 (or the equivalent age
              of digital consent in your jurisdiction). We do not knowingly
              collect personal data from children.
            </p>
          </Section>

          <Section title="12. Changes to this policy">
            <p>
              We may update this policy from time to time. Material changes will
              be communicated by updating the "Last updated" date above and, where
              appropriate, by a notice in the app.
            </p>
          </Section>

          <Section title="13. Contact">
            <p>
              Questions or requests? Email{" "}
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

function Row({
  name,
  purpose,
  category,
}: {
  name: string;
  purpose: string;
  category: "Necessary" | "Optional";
}) {
  return (
    <tr className="border-t border-white/[0.06]">
      <td className="px-3 py-3 align-top font-mono text-[12px] text-white/85">{name}</td>
      <td className="px-3 py-3 align-top text-[13px] text-white/65">{purpose}</td>
      <td className="px-3 py-3 align-top">
        <span
          className={
            category === "Necessary"
              ? "rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/55"
              : "rounded-md border border-primary/30 bg-primary/[0.08] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary/90"
          }
        >
          {category}
        </span>
      </td>
    </tr>
  );
}
