import Link from "next/link";
import { SiteShell } from "@/components/site/site-shell";

export default function NotFound() {
  return (
    <SiteShell footer={false}>
      <div className="flex min-h-[calc(100svh-65px)] flex-col items-center justify-center px-4 text-center">
        <h1 className="m-0 font-display text-[clamp(2rem,4vw,2.5rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-fg">
          Page not found
        </h1>
        <p className="mt-3 text-[16px] text-fg-3">There&apos;s nothing at this address.</p>
        <Link
          href="/"
          className="mt-8 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[14.5px] font-medium text-primary-foreground transition-colors hover:bg-[#c09a45]"
        >
          Go home
        </Link>
      </div>
    </SiteShell>
  );
}
