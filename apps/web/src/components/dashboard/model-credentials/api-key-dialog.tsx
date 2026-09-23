"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { ProviderLogo } from "./provider-logo";
import { isLabelTaken, suggestLabel, type ModelCredential, type ModelProvider } from "./types";

const fieldLabelClass = "font-mono text-[10px] uppercase tracking-[0.22em] text-fg-4";

function ProviderCombobox({
  providers,
  value,
  onChange,
  container,
}: {
  providers: ModelProvider[];
  value: ModelProvider | undefined;
  onChange: (provider: ModelProvider) => void;
  container: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? providers.filter(
          (provider) =>
            provider.displayName.toLowerCase().includes(needle) ||
            provider.name.toLowerCase().includes(needle),
        )
      : providers;
    return [
      ...matches.filter((provider) => provider.featured),
      ...matches.filter((provider) => !provider.featured),
    ];
  }, [providers, query]);
  const featuredCount = filtered.filter((provider) => provider.featured).length;

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const select = (provider: ModelProvider) => {
    onChange(provider);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Provider"
          className="flex h-10 w-full items-center gap-2.5 rounded-lg bg-input/70 px-3.5 text-left text-sm transition-colors outline-none hover:bg-input focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {value ? (
            <>
              <ProviderLogo name={value.name} displayName={value.displayName} />
              <span className="min-w-0 flex-1 truncate text-fg">{value.displayName}</span>
            </>
          ) : (
            <span className="flex-1 text-muted-foreground">Choose a provider</span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-fg-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        portalContainer={container}
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-fg-4" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const provider = filtered[active];
                if (provider) select(provider);
              }
            }}
            placeholder="Search providers"
            aria-label="Search providers"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} role="listbox" className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-fg-4">No matching provider</p>
          )}
          {filtered.map((provider, index) => (
            <div key={provider.id}>
              {(index === 0 || index === featuredCount) && (
                <p className="px-2.5 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-fg-4">
                  {provider.featured ? "Popular" : "More providers"}
                </p>
              )}
              <button
                type="button"
                role="option"
                data-index={index}
                aria-selected={value?.id === provider.id}
                onMouseMove={() => setActive(index)}
                onClick={() => select(provider)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-fg-2",
                  index === active && "bg-fill-2 text-fg",
                )}
              >
                <ProviderLogo name={provider.name} displayName={provider.displayName} />
                <span className="min-w-0 flex-1 truncate">{provider.displayName}</span>
                {provider.fields.length > 0 && (
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-fg-4">
                    + {provider.fields.map((field) => field.label).join(", ")}
                  </span>
                )}
                {value?.id === provider.id && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ApiKeyDialog({
  open,
  onOpenChange,
  ...props
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ModelProvider[];
  credentials: ModelCredential[];
  onSaved: () => void;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={setContainer}
        className="gap-0 overflow-visible border-line bg-settings-dialog p-0 sm:max-w-[480px]"
      >
        {/* Mounted per open, so every open starts from a clean form. */}
        <ApiKeyForm {...props} container={container} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyForm({
  providers,
  credentials,
  onSaved,
  onClose,
  container,
}: {
  providers: ModelProvider[];
  credentials: ModelCredential[];
  onSaved: () => void;
  onClose: () => void;
  container: HTMLElement | null;
}) {
  const apiKeyProviders = useMemo(
    () =>
      providers
        .filter((provider) => provider.authType === "api_key")
        .toSorted(
          (a, b) =>
            Number(b.featured) - Number(a.featured) ||
            (a.featured ? a.order - b.order : a.displayName.localeCompare(b.displayName)),
        ),
    [providers],
  );
  const [providerId, setProviderId] = useState<string>();
  const provider =
    apiKeyProviders.find((candidate) => candidate.id === providerId) ??
    apiKeyProviders.find((candidate) => candidate.isRecommended) ??
    apiKeyProviders[0];
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState(() => suggestLabel(credentials, provider?.id));
  const [fields, setFields] = useState<Record<string, string>>({});

  const choose = (next: ModelProvider) => {
    setProviderId(next.id);
    setFields({});
    setLabel(suggestLabel(credentials, next.id));
  };

  const storeApiKey = useMutation(
    trpc.modelCredentials.storeApiKey.mutationOptions({
      onSuccess: () => {
        track("api_key_saved", { provider: provider?.name, auth_type: "api_key" });
        toast.success(`${provider?.displayName ?? "API"} key saved`);
        onSaved();
        onClose();
      },
      onError: (error) => toast.error(`Failed to save API key: ${error.message}`),
    }),
  );

  const labelTaken = isLabelTaken(credentials, provider?.id, label);
  const missingField = provider?.fields.some((field) => !fields[field.key]?.trim());
  const canSubmit = !!provider && !!apiKey.trim() && !!label.trim() && !labelTaken && !missingField;

  const submit = () => {
    if (!provider || !canSubmit) return;
    storeApiKey.mutate({
      providerName: provider.name,
      apiKey: apiKey.trim(),
      label: label.trim(),
      ...(provider.fields.length
        ? {
            fields: Object.fromEntries(
              provider.fields.map((field) => [field.key, fields[field.key]?.trim() ?? ""]),
            ),
          }
        : {}),
    });
  };

  return (
    <>
      <DialogHeader className="border-b border-line px-5 py-4 text-left sm:px-6">
        <DialogTitle className="text-lg font-semibold tracking-[-0.02em]">Add API key</DialogTitle>
        <DialogDescription className="text-[13px]">
          Keys are encrypted and only sent to your workspaces.
        </DialogDescription>
      </DialogHeader>

      <form
        id="api-key-form"
        className="grid gap-4 px-5 py-5 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-2">
          <Label className={fieldLabelClass}>Provider</Label>
          <ProviderCombobox
            providers={apiKeyProviders}
            value={provider}
            onChange={choose}
            container={container}
          />
        </div>

        {provider && provider.fields.length > 0 && (
          <div className={cn("grid gap-3", provider.fields.length > 1 && "sm:grid-cols-2")}>
            {provider.fields.map((field) => (
              <div key={field.key} className="grid gap-2">
                <Label htmlFor={`field-${field.key}`} className={fieldLabelClass}>
                  {field.label}
                </Label>
                <Input
                  id={`field-${field.key}`}
                  value={fields[field.key] ?? ""}
                  onChange={(event) =>
                    setFields((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  placeholder={field.placeholder}
                  pattern={field.pattern}
                  title={field.patternMessage}
                  className="font-mono"
                  autoComplete="off"
                  required
                />
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="api-key" className={fieldLabelClass}>
              API key
            </Label>
            {provider?.keyUrl && (
              <a
                href={provider.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-fg-3 transition-colors hover:text-fg"
              >
                Get a key
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <Input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider?.keyPlaceholder ?? "Paste your key"}
            className="font-mono"
            autoComplete="off"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="api-key-label" className={fieldLabelClass}>
            Label
          </Label>
          <Input
            id="api-key-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="default, work, personal"
            aria-invalid={labelTaken}
          />
          <p className={cn("text-[11px] text-fg-4", labelTaken && "text-destructive")}>
            {labelTaken
              ? `You already have a ${provider?.displayName} key called "${label.trim()}".`
              : "Tells keys for the same provider apart in workspaces and the SDK."}
          </p>
        </div>
      </form>

      <DialogFooter className="border-t border-line px-5 py-4 sm:px-6">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="api-key-form"
          disabled={!canSubmit || storeApiKey.isPending}
          className="gap-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          {storeApiKey.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {storeApiKey.isPending ? "Saving..." : "Save key"}
        </Button>
      </DialogFooter>
    </>
  );
}
