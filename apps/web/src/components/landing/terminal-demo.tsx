"use client"

import { useEffect, useState } from "react"
import { Cloud, Monitor, Terminal, Box, Globe, Loader2, Check, Server } from "lucide-react"

const localCommands = [
  { prompt: "$ npx @gitterm/agent login", delay: 100 },
  { output: "Logging in to gitterm...", delay: 800 },
  { output: "Logged in successfully!", delay: 600 },
  { prompt: "$ npx @gitterm/agent connect --workspace-id ws_abc123 --port 3000", delay: 1200 },
  { output: "Establishing secure tunnel for workspace...", delay: 700 },
  { output: "Connected! Your local workspace is now live at:", delay: 500 },
  { output: "https://my-app.gitterm.dev", delay: 400, color: "border-green-500/50" },
]

export function TerminalDemo() {
  const [mode, setMode] = useState<"cloud" | "local">("cloud")

  return (
    <div className="flex flex-col gap-4">
      {/* Mode Switcher */}
      <div className="flex items-center justify-center">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-secondary/50 border border-border/50">
          <button
            onClick={() => setMode("cloud")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              mode === "cloud"
                ? "bg-primary/70 text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Cloud className="h-3.5 w-3.5" />
            Cloud
          </button>
          <button
            onClick={() => setMode("local")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              mode === "local"
                ? "bg-primary/70 text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Monitor className="h-3.5 w-3.5" />
            Local
          </button>
        </div>
      </div>

      {/* Demo Content */}
      <div className="relative min-h-[320px]">
        {mode === "local" ? <LocalTerminalDemo /> : <CloudProvisionDemo />}
      </div>
    </div>
  )
}

function LocalTerminalDemo() {
  const [lines, setLines] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    setLines([])
    setCurrentIndex(0)
  }, [])

  useEffect(() => {
    if (currentIndex < localCommands.length) {
      const timer = setTimeout(() => {
        const cmd = localCommands[currentIndex]
        setLines((prev) => [...prev, cmd.prompt || cmd.output || ""])
        setCurrentIndex((prev) => prev + 1)
      }, localCommands[currentIndex]?.delay || 500)
      return () => clearTimeout(timer)
    } else {
      const resetTimer = setTimeout(() => {
        setLines([])
        setCurrentIndex(0)
      }, 3000)
      return () => clearTimeout(resetTimer)
    }
  }, [currentIndex])

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border bg-primary/10 px-4 py-3">
        <div className="h-3 w-3 rounded-full bg-red-500/70" />
        <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <div className="h-3 w-3 rounded-full bg-green-500/70" />
        <span className="ml-3 text-xs text-muted-foreground font-mono">gitterm-agent — zsh</span>
      </div>
      <div className="p-4 font-mono text-sm min-h-[260px] bg-background/50">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`${
              line.startsWith("$")
                ? "text-primary"
                : line.startsWith("https://")
                  ? "text-green-500 font-semibold"
                  : "text-muted-foreground"
            }`}
          >
            {line}
          </div>
        ))}
        <span className="inline-block h-4 w-2 bg-foreground animate-pulse" />
      </div>
    </div>
  )
}

function CloudProvisionDemo() {
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    setActiveStep(0)
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 4)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const steps = [
    { icon: Terminal, label: "Select", description: "Choose agent & provider" },
    { icon: Server, label: "Provision", description: "Spinning up instance" },
    { icon: Globe, label: "Ready", description: "Workspace is live" },
  ]

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-primary/10 px-4 py-3">
        <div className="h-3 w-3 rounded-full bg-red-500/70" />
        <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <div className="h-3 w-3 rounded-full bg-green-500/70" />
        <span className="ml-3 text-xs text-muted-foreground font-mono">gitterm — dashboard</span>
      </div>

      <div className="p-5 min-h-[260px] bg-background/50 flex flex-col gap-5">
        {/* Progress Steps */}
        <div className="flex items-center justify-between gap-2">
          {steps.map((step, index) => {
            const isActive = activeStep === index
            const isComplete = activeStep > index
            const isPending = activeStep < index
            const StepIcon = step.icon

            return (
              <div key={step.label} className="flex items-center flex-1">
                <div
                  className={`flex-1 flex flex-col items-center gap-2 p-3 rounded-lg border transition-all duration-300 ${
                    isActive
                      ? "border-primary bg-primary/5"
                      : isComplete
                        ? "border-green-500/50 bg-green-500/5"
                        : "border-border bg-secondary/20"
                  }`}
                >
                  <div className={`flex items-center justify-center h-8 w-8 rounded-full transition-all duration-300 ${
                    isActive
                      ? "bg-primary/10"
                      : isComplete
                        ? "bg-green-500/10"
                        : "bg-secondary/50"
                  }`}>
                    {isActive && index === 1 ? (
                      <Loader2 className="h-4 w-4 text-primary animate-spin" />
                    ) : isComplete ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <StepIcon className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                    )}
                  </div>
                  <span className={`text-xs font-medium ${isActive ? "text-primary" : isComplete ? "text-green-500" : "text-muted-foreground"}`}>
                    {step.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`w-4 h-px mx-1 transition-colors duration-500 ${
                    activeStep > index ? "bg-green-500" : "bg-border"
                  }`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Provider badges */}
        <div className="flex items-center justify-center gap-2">
          {[
            { name: "Railway", active: true },
            { name: "AWS", active: false },
            { name: "Cloudflare", active: false },
          ].map((provider) => (
            <div
              key={provider.name}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all ${
                provider.active
                  ? "bg-primary/10 border border-primary/20 text-primary"
                  : "bg-secondary/30 border border-border/50 text-muted-foreground"
              }`}
            >
              <Box className="h-3 w-3" />
              {provider.name}
            </div>
          ))}
        </div>

        {/* Terminal output */}
        <div className="font-mono text-xs bg-secondary/30 rounded-md p-3 border border-border/50">
          {activeStep === 0 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <span className="text-foreground">Creating OpenCode workspace on Railway...</span>
            </div>
          )}
          {activeStep === 1 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <span className="text-foreground">Provisioning instance</span>
              <span className="text-primary animate-pulse">...</span>
            </div>
          )}
          {activeStep >= 2 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <span className="text-green-500">Workspace ready!</span>
              </div>
              <div className="flex items-center gap-2 pl-4">
                <span className="text-muted-foreground">→</span>
                <span className="text-green-500 font-medium">https://ws-abc123.gitterm.dev</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
