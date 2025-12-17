"use client"

import { useEffect, useState } from "react"

const commands = [
  { prompt: "$ npx @opeoginni/gitterm-agent login", delay: 100 },
  { output: "Logging in to gitterm...", delay: 800 },
  { output: "Logged in successfully!", delay: 600 },
  { prompt: "$ npx @opeoginni/gitterm-agent connect --workspace-id ws_abc123 --port 3000", delay: 1200 },
  { output: "Establishing secure tunnel for workspace...", delay: 700 },
  { output: "Connected! Your local workspace is now live at:", delay: 500 },
  { output: "https://my-app.gitterm.dev", delay: 400 },
]

export function TerminalDemo() {
  const [lines, setLines] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (currentIndex < commands.length) {
      const timer = setTimeout(() => {
        const cmd = commands[currentIndex]
        setLines((prev) => [...prev, cmd.prompt || cmd.output || ""])
        setCurrentIndex((prev) => prev + 1)
      }, commands[currentIndex]?.delay || 500)
      return () => clearTimeout(timer)
    } else {
      const resetTimer = setTimeout(() => {
        setLines([])
        setCurrentIndex(0)
      }, 4000)
      return () => clearTimeout(resetTimer)
    }
  }, [currentIndex])

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border bg-secondary/20 px-4 py-3">
        <div className="h-3 w-3 rounded-full bg-red-500/70" />
        <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <div className="h-3 w-3 rounded-full bg-green-500/70" />
        <span className="ml-3 text-xs text-muted-foreground font-mono">gitterm-agent - zsh</span>
      </div>
      <div className="p-4 font-mono text-sm min-h-[280px] bg-background/50">
        {lines.map((line, i) => (
          <div 
            key={i} 
            className={`${
              line.startsWith("$") 
                ? "text-primary" 
                : line.startsWith("https://") 
                  ? "text-accent font-semibold" 
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
