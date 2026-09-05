import type { WorkspaceModelsInput } from "@gitterm/schema/workspace-models";

type Provider = { name: string; logicalProviderKey: string; authType: string };
type SavedCredential = {
  id: string;
  logicalProviderKey: string;
  label: string;
  isDefault: boolean;
};

/** Pure selection, before decrypting anything. Labels are scoped to the logical provider. */
export function selectWorkspaceCredentials<T extends SavedCredential>(
  models: WorkspaceModelsInput | undefined,
  providers: Provider[],
  saved: T[],
): Array<
  { source: "saved"; credential: T } | { source: "apiKey"; provider: Provider; apiKey: string }
> {
  const result: ReturnType<typeof selectWorkspaceCredentials<T>> = [];
  const entries = Object.entries(models?.providers ?? {});
  for (const [key, selection] of entries) {
    const available = providers.filter((provider) => provider.logicalProviderKey === key);
    if (!available.length)
      throw new Error(`MODEL_CREDENTIAL_INVALID: Unknown model provider "${key}"`);
    if (selection.source === "apiKey") {
      if (typeof selection.apiKey !== "string" || !selection.apiKey.trim()) {
        throw new Error(`MODEL_CREDENTIAL_INVALID: Inline API key for "${key}" is required`);
      }
      const provider = available.find((candidate) => candidate.authType === "api_key");
      if (!provider)
        throw new Error(`MODEL_CREDENTIAL_INVALID: ${key} requires a saved OAuth credential`);
      result.push({ source: "apiKey", provider, apiKey: selection.apiKey });
      continue;
    }
    const candidates = saved.filter((credential) => credential.logicalProviderKey === key);
    const matches = candidates.filter((credential) =>
      selection.source === "saved" ? credential.label === selection.label : credential.isDefault,
    );
    if (matches.length !== 1) {
      const wanted = selection.source === "saved" ? `label "${selection.label}"` : "default";
      throw new Error(
        `MODEL_CREDENTIAL_UNAVAILABLE: ${key} ${wanted} ${matches.length ? "is ambiguous; give the credentials distinct dashboard labels" : `is unavailable. Available labels: ${candidates.map((credential) => JSON.stringify(credential.label)).join(", ") || "none"}`}`,
      );
    }
    result.push({ source: "saved", credential: matches[0]! });
  }
  // Omitting models keeps dashboard behavior; an explicit models block is least-privilege.
  if (!models || models.inherit === "defaults") {
    const overridden = new Set(entries.map(([key]) => key));
    for (const credential of saved) {
      if (credential.isDefault && !overridden.has(credential.logicalProviderKey)) {
        result.push({ source: "saved", credential });
      }
    }
  }
  return result;
}
