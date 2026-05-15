"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Send, Server } from "lucide-react";
import env from "@gitterm/env/web";

const teamSizes = [
  { value: "1-10", label: "1 - 10 developers" },
  { value: "11-50", label: "11 - 50 developers" },
  { value: "51-200", label: "51 - 200 developers" },
  { value: "200+", label: "200+ developers" },
];

export function EnterpriseContent() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teamSize, setTeamSize] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY) {
      setError("The enterprise contact form is not configured yet. Please email us directly.");
      return;
    }

    const form = e.currentTarget;
    const data = new FormData(form);

    data.append("access_key", env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY);
    data.append("subject", "New GitTerm Enterprise Request");
    data.append("from_name", "GitTerm Enterprise Form");
    data.append("team_size", teamSize);

    setIsSubmitting(true);

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: data,
      });
      const result = (await response.json()) as { success?: boolean; message?: string };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to submit enterprise request");
      }

      form.reset();
      setTeamSize("");
      setSubmitted(true);
    } catch {
      setError("We couldn't send your request. Please email us directly at");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="relative overflow-hidden pt-36 pb-24 md:pt-44 md:pb-32">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.04),transparent)]" />
      </div>

      <div className="relative mx-auto max-w-[1120px] px-6">
        {/* ── Hero ── */}
        <div className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            <Server className="h-3.5 w-3.5 text-primary" />
            Enterprise
          </span>
        </div>

        <h1 className="mx-auto max-w-2xl text-center text-[clamp(2.25rem,5vw,4.5rem)] font-bold leading-[1.08] tracking-tight text-white">
          Run GitTerm on <span className="text-primary">your infra.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-center text-base leading-relaxed text-white/50 sm:text-lg">
          GitTerm is still early, but if you want to run it for your team we&apos;ll help you get
          set up. Tell us what you need and we&apos;ll figure it out together.
        </p>

        {/* ── Form card ── */}
        <div className="mx-auto mt-16 max-w-2xl">
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.02]">
            {/* Card glow */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 left-1/2 h-[300px] w-[500px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.06),transparent)]" />
            </div>

            <div className="relative p-6 md:p-10">
              {submitted ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                    <Send className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-white/90">
                    We&apos;ll be in touch
                  </h3>
                  <p className="max-w-sm text-sm leading-relaxed text-white/45">
                    Your request was sent. If you need to add anything else, email us directly
                    at{" "}
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

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-white/40">
                        Company
                      </label>
                      <Input
                        name="company"
                        required
                        placeholder="Acme Inc."
                        className="h-11 rounded-xl border-white/[0.08] bg-white/[0.03] text-sm text-white/80 placeholder:text-white/20 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-white/40">
                        Team size
                      </label>
                      <Select value={teamSize} onValueChange={setTeamSize}>
                        <SelectTrigger className="h-11 w-full rounded-xl border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white/80 shadow-none hover:bg-white/[0.03] focus-visible:border-primary/40 focus-visible:ring-primary/20 data-[placeholder]:text-white/20 data-[size=default]:h-11 [&>svg]:text-white/30">
                          <SelectValue placeholder="Select team size" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-white/[0.08] bg-[#151518]">
                          {teamSizes.map((size) => (
                            <SelectItem
                              key={size.value}
                              value={size.value}
                              className="rounded-lg text-sm text-white/70 focus:bg-white/[0.06] focus:text-white"
                            >
                              {size.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-white/40">
                      What are you looking for?
                    </label>
                    <Textarea
                      name="message"
                      rows={3}
                      placeholder="Tell us about your team, your infra, and what you want to use GitTerm for."
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
