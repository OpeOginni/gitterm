"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight } from "lucide-react";
import env from "@gitterm/env/web";
import { Band, Wrap } from "@/components/site/section";
import { GITHUB_URL } from "@/lib/site/providers";
import { cn } from "@/lib/utils";

const CONTACT_EMAIL = "enterprise@gitterm.dev";

const principles = [
  {
    title: "Your sandbox, your cloud",
    body: "Workspaces run on infrastructure you control. Nothing leaves your account unless you send it.",
  },
  {
    title: "Your keys, your data",
    body: "Model keys and repo access stay encrypted in your own database. We never see them.",
  },
  {
    title: "Open source, unlimited",
    body: "MIT-licensed. No seat caps, no usage meter, and the full stack is yours to read and fork.",
  },
];

const fieldClass =
  "rounded-lg border-line bg-background text-[15px] text-fg placeholder:text-fg-4 md:text-[15px] focus-visible:border-primary/50 focus-visible:ring-primary/20";
const labelClass = "mb-2 block text-[14px] font-medium text-fg-2";
const primaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[14.5px] font-medium text-primary-foreground transition-colors hover:bg-[#c09a45] disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white/[0.04] px-4 text-[14.5px] font-medium text-fg-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors hover:bg-white/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const goldLink =
  "text-[#e2c47c] underline decoration-[#e2c47c]/40 underline-offset-4 transition-colors hover:decoration-[#e2c47c]";

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
    <>
      <Wrap className="pt-[clamp(56px,8vw,104px)] pb-[clamp(64px,9vw,112px)]">
        <h1 className="m-0 max-w-[16ch] text-[clamp(2.4rem,5.6vw,4.4rem)] leading-[1] font-display font-semibold tracking-[-0.035em] text-balance text-fg">
          Run GitTerm on your own infra.
        </h1>
        <p className="mt-6 max-w-[38rem] text-[clamp(16px,1.5vw,18px)] leading-[1.65] text-pretty text-fg-3">
          GitTerm is open source and self-hostable. Deploy on Railway, AWS, or bare metal, and keep
          every key and every line of code on infrastructure you own.
        </p>

        <div className="mt-[clamp(48px,6vw,72px)] grid gap-px border border-line bg-line md:grid-cols-3">
          {principles.map((item) => (
            <div key={item.title} className="bg-background px-6 pt-6 pb-7">
              <h2 className="m-0 text-[16.5px] font-medium text-fg">{item.title}</h2>
              <p className="mt-2 text-[15px] leading-[1.6] text-fg-3">{item.body}</p>
            </div>
          ))}
        </div>
      </Wrap>

      <Band>
        <Wrap>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-20">
            <div>
              <h2 className="m-0 text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.04] font-display font-medium tracking-[-0.025em] text-balance text-fg">
                Deploying somewhere unusual, or setting this up for a team?
              </h2>
              <p className="mt-5 max-w-[30rem] text-[16px] leading-[1.6] text-fg-3">
                Tell us a little about where you want GitTerm to run. A real person reads every
                message and will get back to you.
              </p>

              <ul className="mt-8 space-y-3 text-[15px] text-fg-2">
                {[
                  "Deployment help for Railway, AWS, or your own servers",
                  "Bringing your existing sandbox provider",
                  "Team, SSO, and enterprise questions",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-3">
                    <span aria-hidden className="mt-[11px] h-px w-3.5 shrink-0 bg-fg-4" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-8 text-[15px] text-fg-3">
                Or email{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className={goldLink}>
                  {CONTACT_EMAIL}
                </a>
              </p>
            </div>

            <div className="rounded-2xl bg-card p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] sm:p-7">
              {submitted ? (
                <div className="flex flex-col items-start py-6">
                  <h3 className="m-0 text-[20px] font-medium tracking-[-0.02em] text-fg">
                    Thanks, we'll be in touch
                  </h3>
                  <p className="mt-2 max-w-sm text-[15px] leading-[1.6] text-fg-3">
                    Your message was sent. If you want to add anything, email{" "}
                    <a href={`mailto:${CONTACT_EMAIL}`} className={goldLink}>
                      {CONTACT_EMAIL}
                    </a>
                    .
                  </p>
                  <button
                    type="button"
                    className={cn(secondaryButton, "mt-6")}
                    onClick={() => {
                      setSubmitted(false);
                      setError("");
                    }}
                  >
                    Send another
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="sh-name" className={labelClass}>
                        Name
                      </label>
                      <Input
                        id="sh-name"
                        name="name"
                        required
                        placeholder="Jane Smith"
                        className={cn(fieldClass, "h-11")}
                      />
                    </div>
                    <div>
                      <label htmlFor="sh-email" className={labelClass}>
                        Work email
                      </label>
                      <Input
                        id="sh-email"
                        name="email"
                        type="email"
                        required
                        placeholder="jane@company.com"
                        className={cn(fieldClass, "h-11")}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="sh-company" className={labelClass}>
                      Company or project <span className="font-normal text-fg-4">(optional)</span>
                    </label>
                    <Input
                      id="sh-company"
                      name="company"
                      placeholder="Acme Inc."
                      className={cn(fieldClass, "h-11")}
                    />
                  </div>

                  <div>
                    <label htmlFor="sh-message" className={labelClass}>
                      Message
                    </label>
                    <Textarea
                      id="sh-message"
                      name="message"
                      rows={4}
                      placeholder="Where do you want to run GitTerm, and what would make it easier?"
                      className={cn(fieldClass, "leading-relaxed")}
                    />
                  </div>

                  {error ? (
                    <p className="rounded-lg bg-fill px-4 py-3 text-[14.5px] leading-relaxed text-fg-2">
                      {error}{" "}
                      <a href={`mailto:${CONTACT_EMAIL}`} className={goldLink}>
                        {CONTACT_EMAIL}
                      </a>
                      .
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={cn(primaryButton, "w-full")}
                  >
                    {isSubmitting ? "Sending..." : "Talk to us"}
                    <ArrowRight className="size-4" />
                  </button>
                  <p className="text-center text-[13px] text-fg-4">
                    No newsletter, no sales sequence. Just a reply.
                  </p>
                </form>
              )}
            </div>
          </div>
        </Wrap>
      </Band>

      <Band>
        <Wrap>
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <h2 className="m-0 text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.04] font-display font-medium tracking-[-0.025em] text-balance text-fg">
                Rather do it yourself?
              </h2>
              <p className="mt-4 text-[16px] leading-[1.6] text-fg-3">
                One-click deploy on Railway, or run the stack from source.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="https://railway.com/template/gitterm?referralCode=o9MFOP"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center"
              >
                <img
                  src="https://railway.com/button.svg"
                  alt="Deploy on Railway"
                  height={40}
                  className="h-10 w-auto opacity-90 transition-opacity hover:opacity-100"
                />
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={secondaryButton}>
                View on GitHub
              </a>
            </div>
          </div>
        </Wrap>
      </Band>
    </>
  );
}
