"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Send, Server, Shield, Lock, GitBranch } from "lucide-react";
import env from "@gitterm/env/web";

export function SelfHostContent() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY) {
      setError("The contact form is not configured yet. Please email us directly.");
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
      setError("We couldn't send your request. Please email us directly at");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-24 md:pt-44 md:pb-32">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.04),transparent)]" />
      </div>

      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="mb-8 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.08]" />
          <span className="marker inline-flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-primary" />
            Self-host · open source
          </span>
        </div>

        <h1 className="font-display text-[clamp(2rem,7vw,5rem)] font-light leading-[1] tracking-tight text-white sm:leading-[0.98]">
          Run GitTerm on{" "}
          <span className="font-display-italic text-[color:var(--cream)]">your own infra</span>.
        </h1>

        <p className="mt-5 max-w-2xl text-[15px] leading-[1.6] text-white/55 sm:mt-6 sm:text-[17px] sm:leading-[1.65]">
          GitTerm is open source and self-hostable. Deploy it on Railway, AWS, or bare metal, bring
          your own sandbox provider, and keep every key and every line of code inside your own
          perimeter. One-click deploy, or reach out if you'd like a hand setting it up.
        </p>
        <div className="mt-10 grid gap-px bg-white/[0.06] sm:mt-14 md:grid-cols-3">
          {[
            {
              icon: Shield,
              title: "Your sandbox, your cloud",
              description:
                "Connect your own E2B, Daytona, Railway, Cloudflare, or AWS accounts. Use whichever sandbox or cloud provider fits your stack.",
            },
            {
              icon: Lock,
              title: "Your keys, your data",
              description:
                "BYOK for everything: model credentials, encryption keys, SSH keys. GitTerm never sees your provider API keys or your source code.",
            },
            {
              icon: GitBranch,
              title: "Open source, unlimited",
              description:
                "MIT-licensed and fully self-hostable. No quotas, no billing, no lock-in. Run as many workspaces as your hardware allows.",
            },
          ].map((item) => (
            <div key={item.title} className="bg-background p-5 sm:p-7">
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <item.icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="mb-2 text-[15px] font-semibold text-white/90">{item.title}</h3>
              <p className="text-sm leading-relaxed text-white/45">{item.description}</p>
            </div>
          ))}
        </div>

        {/* ── Deploy CTA ── */}
        <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:mt-16 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <h3 className="text-[15px] font-semibold text-white/90">Deploy it yourself</h3>
            <p className="mt-1 text-sm leading-relaxed text-white/45">
              Spin up the full GitTerm stack on Railway in one click, or self-host from source.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <a
              href="https://railway.com/template/gitterm?referralCode=o9MFOP"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/85"
            >
              Deploy on Railway
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
            <a
              href="https://github.com/OpeOginni/gitterm"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-5 py-2.5 font-mono text-sm font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
            >
              View on GitHub
            </a>
          </div>
        </div>

        {/* ── Form card ── */}
        <div className="mx-auto mt-12 max-w-2xl sm:mt-16">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="marker">Want help self-hosting?</span>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.02]">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 left-1/2 h-[300px] w-[500px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.06),transparent)]" />
            </div>

            <div className="relative p-5 sm:p-6 md:p-10">
              {submitted ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                    <Send className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-white/90">We'll be in touch</h3>
                  <p className="max-w-sm text-sm leading-relaxed text-white/45">
                    Your request was sent. If you need to add anything else, email us directly at{" "}
                    <a
                      href="mailto:enterprise@gitterm.dev"
                      className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary/60"
                    >
                      enterprise@gitterm.dev
                    </a>
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6 h-10 border-white/[0.08] bg-transparent px-5 font-mono text-xs uppercase tracking-wider text-white/60 hover:border-white/20 hover:text-white/90"
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
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-white/40">
                        Name
                      </label>
                      <Input
                        name="name"
                        required
                        placeholder="Jane Smith"
                        className="h-11 rounded-xl border-white/[0.08] bg-white/[0.03] text-sm text-white/80 placeholder:text-white/20 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-white/40">
                        Work email
                      </label>
                      <Input
                        name="email"
                        type="email"
                        required
                        placeholder="jane@company.com"
                        className="h-11 rounded-xl border-white/[0.08] bg-white/[0.03] text-sm text-white/80 placeholder:text-white/20 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-white/40">
                      Company / project{" "}
                      <span className="text-white/20">(optional)</span>
                    </label>
                    <Input
                      name="company"
                      placeholder="Acme Inc."
                      className="h-11 rounded-xl border-white/[0.08] bg-white/[0.03] text-sm text-white/80 placeholder:text-white/20 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-white/40">
                      What do you need help with?
                    </label>
                    <Textarea
                      name="message"
                      rows={3}
                      placeholder="Tell us which sandbox or cloud provider you want to use, where you're deploying, and how we can help you get set up."
                      className="rounded-xl border-white/[0.08] bg-white/[0.03] text-sm leading-relaxed text-white/80 placeholder:text-white/20 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                    />
                  </div>

                  {error ? (
                    <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200">
                      {error}{" "}
                      <a
                        href="mailto:enterprise@gitterm.dev"
                        className="underline decoration-red-200/40 underline-offset-2 hover:decoration-red-200/70"
                      >
                        enterprise@gitterm.dev
                      </a>
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    size="lg"
                    disabled={isSubmitting}
                    className="h-12 w-full bg-primary px-8 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
                  >
                    {isSubmitting ? "Sending..." : "Get in touch"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
