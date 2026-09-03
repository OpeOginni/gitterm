import { Boxes, Cpu, GitBranch, ShieldCheck, Smartphone } from "lucide-react";

const capabilities = [
  {
    icon: Cpu,
    title: "More power.",
    body: "Big repos and long agent runs on cloud hardware. Keep light work on your laptop.",
  },
  {
    icon: ShieldCheck,
    title: "Safe sandboxes.",
    body: "Try a repo, open a port, shut it down. Off your machine, still reachable from your devices.",
  },
  {
    icon: GitBranch,
    title: "Same workflow.",
    body: "Branch, commit, and push to GitHub like you would locally. Cloud machine, laptop habits.",
  },
  {
    icon: Boxes,
    title: "Agents on demand.",
    body: "Give each task its own workspace. Run several agents at once, then shut them down when the work is done.",
  },
  {
    icon: Smartphone,
    title: "Code from anywhere.",
    body: "Open your workspace from any device. No second computer to maintain, and you only pay for the compute you use.",
  },
];

export function ProblemSection() {
  return (
    <section
      id="problem"
      className="relative overflow-hidden border-t border-line py-14 sm:py-20 md:py-28"
    >
      <div className="relative mx-auto max-w-[1100px] px-4 sm:px-6">
        <div className="mx-auto mb-10 max-w-2xl text-center sm:mx-0 sm:mb-12 sm:text-left">
          <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-white">
            When you need{" "}
            <span className="font-display-accent text-[color:var(--cream)]">more</span> than your
            computer.
          </h2>
        </div>

        <div className="grid gap-px bg-fill-2 md:grid-cols-6">
          {capabilities.map((item, idx) => (
            <div
              key={item.title}
              className={`group bg-background p-5 transition-colors hover:bg-card sm:p-7 ${
                idx < 3 ? "md:col-span-2" : "md:col-span-3"
              }`}
            >
              <div className="mb-6">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-fill text-fg-4 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <item.icon className="h-4 w-4" />
                </span>
              </div>

              <h3 className="text-[15.5px] font-medium leading-snug text-fg">{item.title}</h3>

              <div className="my-4 h-px bg-fill-2" />

              <p className="text-[13.5px] leading-relaxed text-fg-3">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
