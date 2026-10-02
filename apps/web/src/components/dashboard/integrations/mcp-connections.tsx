"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { EXECUTOR_MCP_URL, type McpAuthentication } from "@gitterm/schema/mcp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { queryClient, trpc } from "@/utils/trpc";

type AuthMode = "none" | "bearer" | "headers";
type Form = {
  id?: string;
  integration: "mcp" | "executor";
  name: string;
  url: string;
  authMode: AuthMode;
  token: string;
  headers: string;
  codemode: boolean;
  originalUrl?: string;
  originalAuthType?: string;
};
const emptyForm = (integration: "mcp" | "executor"): Form => ({
  integration,
  name: integration === "executor" ? "Executor" : "",
  url: "",
  authMode: integration === "executor" ? "bearer" : "none",
  token: "",
  headers: "",
  codemode: true,
});
const statusLabels: Record<string, string> = {
  connected: "Test passed",
  untested: "Not tested",
  needs_auth: "Authentication rejected",
  error: "Connection failed",
  suspended: "Suspended",
};

async function refreshMcpConnections() {
  await queryClient.invalidateQueries({ queryKey: trpc.integrations.connections.list.queryKey() });
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4">{label}</span>
      {children}
      {hint ? <span className="block text-xs leading-relaxed text-fg-4">{hint}</span> : null}
    </label>
  );
}

function authentication(current: Form): McpAuthentication | undefined {
  const type = current.authMode === "bearer" ? "headers" : current.authMode;
  const keep =
    current.id && current.url === current.originalUrl && type === current.originalAuthType;
  if (keep && !current.token && !current.headers) return undefined;
  if (type === "none") return { type: "none" };
  if (current.authMode === "bearer") {
    if (!current.token.trim()) throw new Error("Enter a bearer token");
    return { type: "headers", headers: { Authorization: `Bearer ${current.token.trim()}` } };
  }
  let headers: unknown;
  try {
    headers = JSON.parse(current.headers);
  } catch {
    throw new Error("Enter custom headers as a JSON object");
  }
  if (
    !headers ||
    typeof headers !== "object" ||
    Array.isArray(headers) ||
    !Object.values(headers).every((value) => typeof value === "string")
  )
    throw new Error("Header values must be strings");
  return { type: "headers", headers: headers as Record<string, string> };
}

export function McpConnections({
  allowCustom,
  allowExecutor,
}: {
  allowCustom: boolean;
  allowExecutor: boolean;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const {
    data: all = [],
    isLoading,
    error,
  } = useQuery(trpc.integrations.connections.list.queryOptions());
  const connections = all.filter(
    (connection) => connection.integration === "mcp" || connection.integration === "executor",
  );
  const create = useMutation(trpc.integrations.connections.create.mutationOptions());
  const update = useMutation(trpc.integrations.mcp.update.mutationOptions());
  const test = useMutation(trpc.integrations.mcp.test.mutationOptions());
  const remove = useMutation(trpc.integrations.connections.remove.mutationOptions());
  const saving = create.isPending || update.isPending;
  const change = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    try {
      const auth = authentication(form);
      if (form.id) {
        await update.mutateAsync({
          id: form.id,
          name: form.name,
          url: form.url,
          codemode: form.codemode,
          authentication: auth,
        });
        toast.success(
          "Connection updated for new workspaces. Test it again if the endpoint or credentials changed.",
        );
      } else {
        const result = await create.mutateAsync({
          integration: form.integration,
          name: form.name,
          url: form.url,
          codemode: form.codemode,
          authentication: auth!,
        });
        if (result.status !== "pending")
          toast[result.status === "connected" ? "success" : "warning"](
            result.status === "connected"
              ? "MCP connection test passed"
              : "Connection saved. It needs attention before you can attach it.",
            { description: result.status === "saved" ? result.message : undefined },
          );
      }
      setForm(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't save MCP connection");
    } finally {
      await refreshMcpConnections();
    }
  }

  async function action(id: string, kind: "test" | "remove") {
    if (
      kind === "remove" &&
      !window.confirm(
        "Remove this saved connection? Existing workspaces keep their credentials. Revoke the token at the MCP provider or Executor to stop their access.",
      )
    )
      return;
    setBusyId(id);
    try {
      if (kind === "test") {
        const result = await test.mutateAsync({ id });
        toast[result.status === "connected" ? "success" : "error"](result.message);
      } else {
        await remove.mutateAsync({ id });
        if (form?.id === id) setForm(null);
        toast.success("Saved connection removed");
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "MCP operation failed");
    } finally {
      setBusyId(null);
      await refreshMcpConnections();
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-fg">Tools for your agent</h2>
          <p className="mt-1 max-w-lg text-[12.5px] leading-relaxed text-fg-3">
            Connect a remote MCP server, or bring your tool catalog through Executor. OpenCode
            connects directly—GitTerm stays out of the tool traffic.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {allowExecutor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setForm(emptyForm("executor"))}
              disabled={saving || busyId !== null}
              className="gap-2"
            >
              <Image src="/executor.png" width={16} height={16} alt="" />
              Connect Executor
            </Button>
          ) : null}
          {allowCustom ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setForm(emptyForm("mcp"))}
              disabled={saving || busyId !== null}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              Add MCP server
            </Button>
          ) : null}
        </div>
      </header>
      <div className="flex items-start gap-2.5 rounded-lg border border-line bg-fill px-4 py-3 text-xs leading-relaxed text-fg-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-fg-3" />
        <p>
          Credentials are encrypted in GitTerm, then delivered to the workspaces you select. Their
          agents can read and use those credentials. Executor can keep service keys behind its
          gateway, but its access token is still available to the agent. Use narrowly scoped tokens
          and connect only servers you trust.
        </p>
      </div>

      {form ? (
        <form
          onSubmit={submit}
          className="space-y-5 rounded-xl border border-line-2 bg-settings p-5"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
            <h3 className="text-sm font-semibold text-fg">
              {form.id
                ? "Edit connection"
                : form.integration === "executor"
                  ? "Connect Executor"
                  : "New MCP connection"}
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancel connection form"
              disabled={saving}
              onClick={() => setForm(null)}
            >
              <X className="size-4" />
            </Button>
          </div>
          {form.integration === "executor" ? (
            <p className="text-xs leading-relaxed text-fg-3">
              Configure your apps in{" "}
              <a
                href="https://executor.sh"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Executor
              </a>
              , then copy your organization&apos;s MCP endpoint and PAT from its API keys page.
              Replace the organization placeholder in the example URL below. Public HTTPS
              self-hosted endpoints work too. Verify the permissions and approval behavior of your
              Executor deployment.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Connection name">
              <Input
                autoFocus
                required
                maxLength={100}
                value={form.name}
                onChange={(event) => change("name", event.target.value)}
                placeholder="e.g. Documentation · personal"
              />
            </Field>
            <Field
              label="MCP endpoint"
              hint="Public HTTPS Streamable HTTP endpoint. Connection tests block private-network addresses."
            >
              <Input
                required
                type="url"
                value={form.url}
                onChange={(event) => change("url", event.target.value)}
                placeholder={
                  form.integration === "executor" ? EXECUTOR_MCP_URL : "https://mcp.example.com/mcp"
                }
                spellCheck={false}
              />
            </Field>
          </div>
          <Field
            label="Authentication"
            hint={
              form.id
                ? "Leave credential fields blank to retain authentication when the endpoint is unchanged."
                : "No auth, bearer tokens, and custom headers are supported. GitTerm-managed OAuth is not included."
            }
          >
            <select
              value={form.authMode}
              onChange={(event) => change("authMode", event.target.value as AuthMode)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="none">No authentication</option>
              <option value="bearer">Bearer token / API key</option>
              <option value="headers">Custom authentication headers</option>
            </select>
          </Field>
          {form.authMode === "bearer" ? (
            <Field label="Bearer token">
              <Input
                type="password"
                autoComplete="new-password"
                value={form.token}
                onChange={(event) => change("token", event.target.value)}
                placeholder={
                  form.id ? "Leave blank to keep existing credential" : "Paste your token"
                }
              />
            </Field>
          ) : null}
          {form.authMode === "headers" ? (
            <Field
              label="Header JSON"
              hint="Values are encrypted; cookies and transport/proxy headers are not allowed."
            >
              <textarea
                rows={3}
                autoComplete="off"
                spellCheck={false}
                value={form.headers}
                onChange={(event) => change("headers", event.target.value)}
                placeholder={
                  form.id ? "Leave blank to keep existing headers" : '{"X-API-Key": "your-key"}'
                }
                className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
              />
            </Field>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-fg-3">
            <Checkbox
              checked={form.codemode}
              onCheckedChange={(checked) => change("codemode", checked === true)}
            />
            Use OpenCode Code Mode (recommended)
          </label>
          {form.id ? (
            <p className="text-xs leading-relaxed text-fg-4">
              Changes apply to newly created workspaces. Existing workspaces keep their
              configuration and credentials; revoke tokens at the provider to stop their access.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {form.id ? "Save changes" : "Save and test"}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          Couldn&apos;t load MCP connections: {error.message}
        </p>
      ) : null}
      {isLoading ? <p className="text-xs text-fg-4">Loading connections…</p> : null}
      {!isLoading && !error && !connections.length ? (
        <div className="rounded-xl border border-dashed border-line px-5 py-8 text-center">
          <p className="text-sm text-fg-3">No MCP servers connected yet</p>
          <p className="mt-1 text-xs text-fg-4">
            Start with a documentation server, or connect your existing Executor catalog.
          </p>
        </div>
      ) : null}
      <div className="space-y-3">
        {connections.map((connection) => {
          const details = connection.details;
          if (details.integration !== "mcp" && details.integration !== "executor") return null;
          return (
            <article key={connection.id} className="rounded-xl border border-line bg-settings p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Image
                    src={connection.integration === "executor" ? "/executor.png" : "/mcp.svg"}
                    width={24}
                    height={24}
                    alt=""
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-medium text-fg">{connection.name}</h3>
                    <p className="mt-1 break-all font-mono text-[11px] text-fg-4">{details.url}</p>
                    <p className="mt-2 text-xs text-fg-3">
                      <span
                        className={
                          connection.status === "connected" ? "text-emerald-400" : "text-amber-400"
                        }
                      >
                        {statusLabels[connection.status]}
                      </span>
                      {details.toolCount !== null ? ` · ${details.toolCount} tools` : ""} ·{" "}
                      {details.authType === "none" ? "No auth" : "Encrypted headers"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {busyId === connection.id ? (
                    <Loader2 className="mr-2 size-3.5 animate-spin text-fg-3" />
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId !== null || saving}
                    onClick={() => action(connection.id, "test")}
                  >
                    Test
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={saving || busyId !== null}
                    aria-label={`Edit ${connection.name}`}
                    onClick={() =>
                      setForm({
                        ...emptyForm(connection.integration as "mcp" | "executor"),
                        id: connection.id,
                        name: connection.name,
                        url: details.url,
                        originalUrl: details.url,
                        originalAuthType: details.authType,
                        authMode: details.authType,
                        codemode: details.codemode,
                      })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={busyId !== null || saving}
                    aria-label={`Remove ${connection.name}`}
                    onClick={() => action(connection.id, "remove")}
                  >
                    <Trash2 className="size-3.5 text-fg-4" />
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
