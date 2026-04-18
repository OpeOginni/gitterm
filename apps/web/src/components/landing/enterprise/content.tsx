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

const teamSizes = [
  { value: "1-10", label: "1 - 10 developers" },
  { value: "11-50", label: "11 - 50 developers" },
  { value: "51-200", label: "51 - 200 developers" },
  { value: "200+", label: "200+ developers" },
];

export function EnterpriseContent() {
  const [submitted, setSubmitted] = useState(false);
  const [teamSize, setTeamSize] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    const name = data.get("name") as string;
    const email = data.get("email") as string;
    const company = data.get("company") as string;
    const message = data.get("message") as string;

    const subject = encodeURIComponent(`GitTerm Enterprise — ${company || name}`);
    const body = encodeURIComponent(
      [
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company}`,
        `Team size: ${teamSize}`,
        ``,
        message,
      ].join("\n"),
    );

    window.open(`mailto:brightoginni123@gmail.com?subject=${subject}&body=${body}`, "_self");

    setSubmitted(true);
  }

  return (
    <section className="relative overflow-hidden pt-36 pb-24 md:pt-44 md:pb-32">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.03),transparent)]" />
      </div>

      <div className="relative mx-auto max-w-[1120px] px-6">
        {/* ── Hero ── */}
        <div className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <Server className="h-3.5 w-3.5 text-primary" />
            Enterprise
          </span>
        </div>

        <h1 className="mx-auto max-w-2xl text-center text-[clamp(2.25rem,5vw,4.5rem)] font-bold leading-[1.08] tracking-tight text-foreground">
          Run GitTerm on <span className="text-primary">your infra.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-center text-base leading-relaxed text-muted-foreground sm:text-lg">
          GitTerm is still early, but if you want to run it for your team we&apos;ll help you get
          set up. Tell us what you need and we&apos;ll figure it out together.
        </p>

        {/* ── Form card ── */}
        <div className="mx-auto mt-16 max-w-2xl">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-card">
            {/* Card glow */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 left-1/2 h-[300px] w-[500px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.04),transparent)]" />
            </div>

            <div className="relative p-6 md:p-10">
              {submitted ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                    <Send className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-foreground">
                    We&apos;ll be in touch
                  </h3>
                  <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Your email client should have opened with a pre-filled message. If it
                    didn&apos;t, email us directly at{" "}
                    <a
                      href="mailto:brightoginni123@gmail.com"
                      className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary/60"
                    >
                      brightoginni123@gmail.com
                    </a>
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6 h-10 border-border bg-transparent px-5 font-mono text-xs uppercase tracking-wider text-secondary-foreground hover:border-foreground/20 hover:text-foreground"
                    onClick={() => setSubmitted(false)}
                  >
                    Send another
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                        Name
                      </label>
                      <Input
                        name="name"
                        required
                        placeholder="Jane Smith"
                        className="h-11 rounded-xl border-border bg-secondary text-sm text-foreground/85 placeholder:text-muted-foreground/50 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                        Work email
                      </label>
                      <Input
                        name="email"
                        type="email"
                        required
                        placeholder="jane@company.com"
                        className="h-11 rounded-xl border-border bg-secondary text-sm text-foreground/85 placeholder:text-muted-foreground/50 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                      />
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                        Company
                      </label>
                      <Input
                        name="company"
                        required
                        placeholder="Acme Inc."
                        className="h-11 rounded-xl border-border bg-secondary text-sm text-foreground/85 placeholder:text-muted-foreground/50 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                        Team size
                      </label>
                      <Select value={teamSize} onValueChange={setTeamSize}>
                        <SelectTrigger className="h-11 w-full rounded-xl border-border bg-secondary text-sm text-foreground/85 focus:ring-primary/20 data-[placeholder]:text-muted-foreground/50 [&>svg]:text-muted-foreground">
                          <SelectValue placeholder="Select team size" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-border bg-popover">
                          {teamSizes.map((size) => (
                            <SelectItem
                              key={size.value}
                              value={size.value}
                              className="rounded-lg text-sm text-foreground/80 focus:bg-secondary focus:text-foreground"
                            >
                              {size.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                      What are you looking for?
                    </label>
                    <Textarea
                      name="message"
                      rows={3}
                      placeholder="Tell us about your team, your infra, and what you want to use GitTerm for."
                      className="rounded-xl border-border bg-secondary text-sm leading-relaxed text-foreground/85 placeholder:text-muted-foreground/50 focus-visible:border-primary/40 focus-visible:ring-primary/20"
                    />
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    className="h-12 w-full bg-primary px-8 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
                  >
                    Get in touch
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
