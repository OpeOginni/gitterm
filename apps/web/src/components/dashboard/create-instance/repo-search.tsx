"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Search, Loader2, Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Repository } from "./types";
import { Badge } from "@/components/ui/badge";

interface RepoSearchProps {
  repos: Repository[] | undefined;
  isLoading: boolean;
  value: Repository | null;
  onChange: (repo: Repository | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Simple filter match with scoring for sorting results
 */
function filterMatch(query: string, target: string): { match: boolean; score: number } {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  
  if (!query) return { match: true, score: 0 };
  
  // Exact match gets highest score
  if (lowerTarget === lowerQuery) return { match: true, score: 1000 };
  
  // Starts with gets high score
  if (lowerTarget.startsWith(lowerQuery)) return { match: true, score: 500 };
  
  // Contains gets medium score
  if (lowerTarget.includes(lowerQuery)) return { match: true, score: 200 };
  
  return { match: false, score: 0 };
}

export function RepoSearch({
  repos,
  isLoading,
  value,
  onChange,
  disabled = false,
  placeholder = "Search repositories...",
}: RepoSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter and sort repos based on search query
  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    
    if (!query.trim()) {
      // No query - return first 20 repos
      return repos.slice(0, 20);
    }
    
    // Score and filter repos
    const scored = repos
      .map((repo) => {
        // Check both full name and repo name
        const fullNameMatch = filterMatch(query, repo.fullName);
        const nameMatch = filterMatch(query, repo.name);
        const bestScore = Math.max(fullNameMatch.score, nameMatch.score);
        
        return {
          repo,
          score: bestScore,
          match: fullNameMatch.match || nameMatch.match,
        };
      })
      .filter((item) => item.match && item.score > 0)
      .sort((a, b) => b.score - a.score);
    
    return scored.map((item) => item.repo).slice(0, 20);
  }, [repos, query]);

  // Calculate dynamic height based on content
  const listHeight = useMemo(() => {
    const itemHeight = 40; // Approximate height per repo item
    const maxHeight = 280;
    const minHeight = 60; // For empty/loading states
    
    if (isLoading || filteredRepos.length === 0) {
      return minHeight;
    }
    
    const contentHeight = filteredRepos.length * itemHeight + 8; // +8 for padding
    return Math.min(contentHeight, maxHeight);
  }, [filteredRepos.length, isLoading]);

  // Focus input when expanded
  useEffect(() => {
    if (expanded && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [expanded]);

  const handleSelect = (repo: Repository) => {
    onChange(repo);
    setExpanded(false);
    setQuery("");
  };

  const handleTriggerClick = () => {
    if (!disabled && !isLoading) {
      setExpanded(!expanded);
    }
  };

  return (
    <div className="grid gap-2" ref={containerRef}>
      <Label className="text-sm font-medium">Repository</Label>
      <div className="relative">
        {/* Trigger button */}
        <button
          type="button"
          onClick={handleTriggerClick}
          disabled={disabled || isLoading}
          className={cn(
            "flex items-center justify-between w-full px-3 py-2 text-sm rounded-md border bg-secondary/30 border-border/50 hover:bg-secondary/50 transition-colors text-left",
            disabled && "opacity-50 cursor-not-allowed",
            !value && "text-muted-foreground",
            expanded && "rounded-b-none border-b-0"
          )}
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading repositories...</span>
            </div>
          ) : value ? (
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{value.fullName}</span>
              {value.private && (
                <Badge variant="secondary" className="text-xs bg-white text-black">
                  Private
                </Badge>
              )}
            </div>
          ) : (
            <span>Select a repository</span>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 opacity-50" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </button>

        {/* Expandable list */}
        {expanded && (
          <div className="border border-t-0 border-border/50 rounded-b-md bg-secondary/30 overflow-hidden">
            {/* Search input */}
            <div className="p-2 border-b border-border/30">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={placeholder}
                  className="pl-8 h-9 bg-secondary/30 border-border/30"
                />
              </div>
            </div>

            {/* Repository list */}
            <ScrollArea style={{ height: listHeight }}>
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredRepos.length > 0 ? (
                <div className="p-1">
                  {filteredRepos.map((repo) => (
                    <button
                      key={repo.id}
                      type="button"
                      onClick={() => handleSelect(repo)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary/60 transition-colors text-left",
                        value?.id === repo.id && "bg-secondary/60"
                      )}
                    >
                      <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{repo.fullName}</p>
                      </div>
                      {repo.private && (
                        <Badge variant="secondary" className="text-xs bg-white text-black shrink-0">
                          Private
                        </Badge>
                      )}
                      {value?.id === repo.id && (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              ) : query ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No repositories found matching "{query}"
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No repositories available
                </div>
              )}
              {!query && repos && repos.length > 20 && (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border/30">
                  Type to search {repos.length} repositories
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
