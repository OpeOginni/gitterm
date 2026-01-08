"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Search, X, Loader2, Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RepoFile } from "./types";

interface RepoFileSearchProps {
  installationId: string;
  owner: string;
  repo: string;
  branch?: string;
  value: RepoFile | null;
  onChange: (file: RepoFile | null) => void;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  extensions?: string[];
}

export function RepoFileSearch({
  installationId,
  owner,
  repo,
  branch,
  value,
  onChange,
  label,
  placeholder = "Search files...",
  description,
  required = false,
  extensions = ["txt", "md", "json"],
}: RepoFileSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Focus input when expanded
  useEffect(() => {
    if (expanded && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [expanded]);

  const { data: filesData, isLoading } = useQuery({
    ...trpc.github.searchFiles.queryOptions({
      installationId,
      owner,
      repo,
      query: debouncedQuery,
      ref: branch,
      extensions,
    }),
    enabled: expanded && !!installationId && !!owner && !!repo && debouncedQuery.length > 0,
  });

  const handleSelect = useCallback((file: RepoFile) => {
    onChange(file);
    setExpanded(false);
    setSearchQuery("");
  }, [onChange]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  }, [onChange]);

  const handleTriggerClick = () => {
    if (installationId && owner && repo) {
      setExpanded(!expanded);
    }
  };

  const isDisabled = !installationId || !owner || !repo;

  // Calculate dynamic height based on content
  const filesCount = filesData?.files?.length ?? 0;
  const listHeight = useMemo(() => {
    const itemHeight = 52; // Approximate height per file item (has 2 lines)
    const maxHeight = 280;
    const minHeight = 60; // For empty/loading states
    
    if (isLoading || debouncedQuery.length === 0 || filesCount === 0) {
      return minHeight;
    }
    
    const contentHeight = filesCount * itemHeight + 8; // +8 for padding
    return Math.min(contentHeight, maxHeight);
  }, [filesCount, isLoading, debouncedQuery.length]);

  return (
    <div className="grid gap-2">
      <Label className="text-sm font-medium">
        {label}
        {!required && <span className="text-muted-foreground font-normal ml-1">(optional)</span>}
      </Label>
      <div className="relative">
        {/* Trigger button */}
        <button
          type="button"
          onClick={handleTriggerClick}
          disabled={isDisabled}
          className={cn(
            "flex items-center justify-between w-full px-3 py-2 text-sm rounded-md border bg-secondary/30 border-border/50 hover:bg-secondary/50 transition-colors text-left",
            isDisabled && "opacity-50 cursor-not-allowed",
            !value && "text-muted-foreground",
            expanded && "rounded-b-none border-b-0"
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {value ? value.path : placeholder}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {value && (
              <X
                className="h-4 w-4 shrink-0 opacity-50 hover:opacity-100"
                onClick={handleClear}
              />
            )}
            {expanded ? (
              <ChevronUp className="h-4 w-4 shrink-0 opacity-50" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            )}
          </div>
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
                  placeholder={`Search ${extensions.join(", ")} files...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 bg-secondary/30 border-border/30"
                />
              </div>
            </div>

            {/* File list */}
            <ScrollArea style={{ height: listHeight }}>
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : debouncedQuery.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Type to search for files...
                </div>
              ) : filesData?.files && filesData.files.length > 0 ? (
                <div className="p-1">
                  {filesData.files.map((file: RepoFile) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => handleSelect(file)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary/60 transition-colors text-left",
                        value?.path === file.path && "bg-secondary/60"
                      )}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 truncate">
                        <p className="font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{file.path}</p>
                      </div>
                      {value?.path === file.path && (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No files found matching "{debouncedQuery}"
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
