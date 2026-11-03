import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Content width used across marketing pages (Workbench: 1240px, 24px gutters, 16px on phones). */
export function Wrap({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  /** 1400px, for demos that need room (hero demo, chapters). */
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6",
        wide ? "max-w-[1400px]" : "max-w-[1240px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A full-width band with a hairline on top. Vertical rhythm: clamp(64px, 9vw, 112px). */
export function Band({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-20 border-t border-line py-[clamp(64px,9vw,112px)]", className)}
    >
      {children}
    </section>
  );
}

/** "+ Extend your laptop": the small gold part heading. The only decorative use of "+". */
export function PartHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("mb-3.5 text-[15px] font-medium text-[#e2c47c]", className)}>
      <span aria-hidden className="mr-2.5 font-light">
        +
      </span>
      {children}
    </p>
  );
}

/** Section heading: h2 on the left, one short paragraph on the right (stacks on phones). */
export function SectionHead({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-11 grid gap-x-12 gap-y-4 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] min-[900px]:items-end",
        className,
      )}
    >
      <h2 className="m-0 text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.04] font-display font-medium tracking-[-0.025em] text-balance text-fg">
        {title}
      </h2>
      {children && (
        <div className="text-[16px] leading-[1.6] text-fg-3 [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:text-fg">
          {children}
        </div>
      )}
    </div>
  );
}
