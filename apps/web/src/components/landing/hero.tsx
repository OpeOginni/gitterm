import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Terminal, Code2, Cloud } from "lucide-react";

export function Hero() {
  return (
    <section className="relative flex flex-col items-center justify-center space-y-10 py-24 text-center md:py-32 lg:py-40 overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]"></div>
      <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-primary/20 opacity-20 blur-[100px]"></div>
      
      <div className="container flex flex-col items-center gap-4 text-center">
        <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
          <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse"></span>
          Now in Public Beta
        </div>
        
        <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl max-w-3xl">
          Your Cloud Development <br className="hidden sm:inline" />
          <span className="text-primary">Workspace Platform</span>
        </h1>
        
        <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8">
          Spin up ephemeral development environments in seconds. Connect your GitHub repos, 
          configure your agents, and start coding instantly.
        </p>
        
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/dashboard">
            <Button size="lg" className="h-12 px-8 text-base">
              Get Started <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>

        </div>
      </div>

      <div className="container mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3 max-w-5xl">
        <FeatureCard 
          icon={<Code2 className="h-10 w-10 text-primary" />}
          title="Instant Setup"
          description="Connect your repo and we'll auto-detect the best environment for your stack."
        />
        <FeatureCard 
          icon={<Terminal className="h-10 w-10 text-primary" />}
          title="AI-Ready Agents"
          description="Pre-configured workspaces with OpenCode, Claude, and other AI coding agents."
        />
        <FeatureCard 
          icon={<Cloud className="h-10 w-10 text-primary" />}
          title="Multi-Cloud"
          description="Deploy your workspaces to Railway, AWS, or your own infrastructure seamlessy."
        />
      </div>
    </section>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="flex flex-col items-center space-y-4 rounded-lg border p-6 shadow-sm bg-card text-card-foreground">
      <div className="p-2 rounded-full bg-primary/10">
        {icon}
      </div>
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="text-muted-foreground text-center text-sm">
        {description}
      </p>
    </div>
  );
}

