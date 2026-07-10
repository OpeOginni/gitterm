"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "Is this meant to replace my laptop?",
    a: "No. Use it for heavier runs, temporary sandboxes, or agents you want off your machine but still reachable.",
  },
  {
    q: "Do I bring my own model keys?",
    a: "Yes. Your Anthropic, OpenAI, or other keys. Encrypted, reused across workspaces, never marked up.",
  },
  {
    q: "Which clouds can workspaces run on?",
    a: "E2B, Daytona, Railway, AWS, or Cloudflare. Configure the ones you want and pick per workspace. No lock-in.",
  },
  {
    q: "Is it open source? Can I self-host?",
    a: "Yes. MIT-licensed, full stack on GitHub. One-click on Railway, or Docker anywhere.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="border-t border-white/[0.06] py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-[820px] px-4 sm:px-6">
        <div className="mb-10 max-w-xl sm:mb-12">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="marker">FAQ</span>
          </div>
          <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-white">
            Frequently asked questions.
          </h2>
        </div>

        <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          {faqs.map((faq) => (
            <FaqItem key={faq.q} question={faq.q} answer={faq.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 py-5 text-left text-[15px] font-medium text-white/85 transition-colors hover:text-white sm:text-base"
      >
        {question}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/40 transition-transform duration-300 ease-out ${
            open ? "rotate-180 text-white/70" : ""
          }`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <p
            className={`max-w-2xl pb-5 text-[13.5px] leading-relaxed text-white/50 transition-opacity duration-300 ease-out sm:text-sm ${
              open ? "opacity-100" : "opacity-0"
            }`}
          >
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
