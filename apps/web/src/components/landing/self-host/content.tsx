"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Send, Shield, Lock, GitBranch, Mail } from "lucide-react";
import env from "@gitterm/env/web";

const CONTACT_EMAIL = "enterprise@gitterm.dev";

const principles = [
  {
    icon: Shield,
    title: "Your sandbox, your cloud",
    body: "Workspaces run on infrastructure you control. Nothing leaves your account unless you send it.",
  },
  {
    icon: Lock,
    title: "Your keys, your data",
    body: "Model keys and repo access stay encrypted in your own database. We never see them.",
  },
  {
    icon: GitBranch,
    title: "Open source, unlimited",
    body: "MIT-licensed. No seat caps, no usage meter, and the full stack is yours to read and fork.",
  },
];

const fieldClass =
  "h-11 rounded-lg border-line bg-background text-sm text-fg placeholder:text-fg-4 focus-visible:border-primary/50 focus-visible:ring-primary/20";

export function SelfHostContent() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY) {
      setError("The contact form is not configured yet. Please email us directly at");
      return;
    }

    const form = e.currentTarget;
    const data = new FormData(form);

    data.append("access_key", env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY);
    data.append("subject", "New GitTerm Self-host Request");
    data.append("from_name", "GitTerm Self-host Form");

    setIsSubmitting(true);

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: data,
      });
      const result = (await response.json()) as { success?: boolean; message?: string };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to submit request");
      }

      form.reset();
      setSubmitted(true);
    } catch {
      setError("We couldn't send your message. Please email us directly at");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-24 md:pt-44 md:pb-32">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgba(211,173,85,0.05),transparent)]" />
      </div>

      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6">
        <h1 className="font-display text-[clamp(2rem,7vw,5rem)] font-light leading-[1] tracking-tight text-white sm:leading-[0.98]">
          Run GitTerm on{" "}
          <span className="font-display-accent text-[color:var(--cream)]">your own infra</span>.
        </h1>

        <p className="mt-5 max-w-2xl text-[15px] leading-[1.6] text-fg-3 sm:mt-6 sm:text-[17px] sm:leading-[1.65]">
          GitTerm is open source and self-hostable. Deploy on Railway, AWS, or bare metal, and keep
          every key and every line of code on infrastructure you own.
        </p>

        {/* ── Principles: three facts on the page itself, no boxes ── */}
        <div className="mt-12 border-y border-line sm:mt-16">
          <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
            {principles.map((item, index) => (
              <div key={item.title} className="py-6 md:px-7 md:py-8 md:first:pl-0 md:last:pr-0">
                <div className="mb-4 flex items-center gap-3">
                  <span className="font-mono text-[10.5px] tracking-[0.18em] text-primary/80">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <item.icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-[16px] font-medium text-fg">{item.title}</h3>
                <p className="mt-2 text-[13.5px] leading-[1.65] text-fg-3">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Talk to us ── */}
        <div className="mt-14 grid gap-10 sm:mt-20 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div className="lg:pt-2">
            <span className="marker">Talk to us</span>
            <h2 className="mt-4 font-display text-[clamp(1.8rem,3.6vw,2.8rem)] font-light leading-[1.05] tracking-tight text-fg">
              Deploying somewhere unusual, or setting this up for a team?
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-[1.65] text-fg-3">
              Tell us a little about where you want GitTerm to run. A real person reads every
              message and will get back to you.
            </p>

            <ul className="mt-7 space-y-3 text-[14px] text-fg-2">
              {[
                "Deployment help for Railway, AWS, or your own servers",
                "Bringing your existing sandbox provider",
                "Team, SSO, and enterprise questions",
              ].map((line) => (
                <li key={line} className="flex items-start gap-3">
                  <span className="mt-[9px] h-px w-4 shrink-0 bg-primary/70" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-8 inline-flex items-center gap-2.5 font-mono text-[13.5px] text-fg-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-fg hover:decoration-primary/60"
            >
              <Mail className="h-4 w-4 text-primary" />
              {CONTACT_EMAIL}
            </a>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-line bg-card shadow-[0_30px_100px_-40px_rgba(0,0,0,0.7)]">
            <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

            <div className="p-5 sm:p-7">
              {submitted ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
                    <Send className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-fg">Thanks, we'll be in touch</h3>
                  <p className="max-w-sm text-sm leading-relaxed text-fg-3">
                    Your message was sent. If you want to add anything, email{" "}
                    <a
                      href={`mailto:${CONTACT_EMAIL}`}
                      className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary/60"
                    >
                      {CONTACT_EMAIL}
                    </a>
                    .
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6 h-10 border-line bg-transparent px-5 font-mono text-xs uppercase tracking-wider text-fg-2 hover:border-line-2 hover:text-fg"
                    onClick={() => {
                      setSubmitted(false);
                      setError("");
                    }}
                  >
                    Send another
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-fg-3">
                        Name
                      </label>
                      <Input name="name" required placeholder="Jane Smith" className={fieldClass} />
                    </div>
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-fg-3">
                        Work email
                      </label>
                      <Input
                        name="email"
                        type="email"
                        required
                        placeholder="jane@company.com"
                        className={fieldClass}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-fg-3">
                      Company / project <span className="text-fg-4">(optional)</span>
                    </label>
                    <Input name="company" placeholder="Acme Inc." className={fieldClass} />
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-fg-3">
                      Message
                    </label>
                    <Textarea
                      name="message"
                      rows={4}
                      placeholder="Where do you want to run GitTerm, and what would make it easier?"
                      className="rounded-lg border-line bg-background text-sm leading-relaxed text-fg placeholder:text-fg-4 focus-visible:border-primary/50 focus-visible:ring-primary/20"
                    />
                  </div>

                  {error ? (
                    <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-relaxed text-fg-2">
                      {error}{" "}
                      <a
                        href={`mailto:${CONTACT_EMAIL}`}
                        className="text-fg underline decoration-line-2 underline-offset-2"
                      >
                        {CONTACT_EMAIL}
                      </a>
                      .
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    size="lg"
                    disabled={isSubmitting}
                    className="group h-12 w-full bg-primary px-8 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-primary-foreground hover:bg-primary/90"
                  >
                    {isSubmitting ? "Sending..." : "Talk to us"}
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </Button>
                  <p className="text-center text-[11.5px] text-fg-4">
                    No newsletter, no sales sequence. Just a reply.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* ── Deploy CTA ── */}
        <div className="mt-16 flex flex-col items-start gap-5 border-t border-line pt-10 sm:mt-20 sm:flex-row sm:items-center sm:justify-between sm:pt-12">
          <div>
            <h3 className="text-[15px] font-semibold text-fg">Rather do it yourself?</h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-3">
              One-click deploy on Railway, or run the stack from source.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <a
              href="https://railway.com/template/gitterm?referralCode=o9MFOP"
              target="_blank"
              rel="noreferrer"
            >
              <img
                src="https://railway.com/button.svg"
                alt="Deploy on Railway"
                height={40}
                className="opacity-90 transition-opacity hover:opacity-100"
              />
            </a>
            <a
              href="https://github.com/OpeOginni/gitterm"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-line bg-fill px-5 font-mono text-sm font-medium text-fg-2 transition-colors hover:border-line-2 hover:text-fg"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
