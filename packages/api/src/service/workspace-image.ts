import { TRPCError } from "@trpc/server";

/**
 * Bring-your-own workspace images on the managed service.
 *
 * Registry-backed providers accept any OCI image reference that can be pulled
 * anonymously. E2B accepts a public template id or alias. Nothing here stores
 * or forwards registry credentials: the managed service only runs public
 * images, so we verify that up front and fail creation with a clear reason
 * instead of leaving a workspace stuck pulling.
 */

export type CustomImageKind = "registry" | "e2b-template";

const PROVIDER_IMAGE_KIND: Record<string, CustomImageKind> = {
  railway: "registry",
  aws: "registry",
  daytona: "registry",
  exedev: "registry",
  e2b: "e2b-template",
};

export function customImageKindForProvider(providerKey: string): CustomImageKind | null {
  return PROVIDER_IMAGE_KIND[providerKey.toLowerCase()] ?? null;
}

export type ParsedImageReference = {
  /** Registry host, e.g. `registry-1.docker.io` or `ghcr.io`. */
  registry: string;
  /** Repository path, e.g. `library/node` or `acme/agent-runner`. */
  repository: string;
  tag: string | null;
  digest: string | null;
};

// Groups: 1 = registry host (optional), 2 = repository, 3 = tag, 4 = digest.
// Indexed groups keep this compatible with consumers compiled below ES2018.
const REFERENCE_PATTERN =
  /^(?:([a-z0-9.-]+(?::[0-9]+)?)\/)?([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)(?::([A-Za-z0-9_][A-Za-z0-9._-]{0,127}))?(?:@(sha256:[a-f0-9]{64}))?$/;

const FLOATING_TAGS = new Set(["latest", "lts", "stable", "main", "master", "edge", "nightly"]);

/** Parse a Docker/OCI reference; Docker Hub shorthand (`node`, `acme/tool`) is normalised. */
export function parseImageReference(reference: string): ParsedImageReference | null {
  const match = REFERENCE_PATTERN.exec(reference.trim());
  if (!match) return null;
  let registry: string | undefined = match[1];
  let repository = match[2] ?? "";
  // A single-segment prefix without a dot, colon, or `localhost` is a Docker Hub
  // namespace, not a registry host (e.g. `acme/tool`).
  if (registry && !registry.includes(".") && !registry.includes(":") && registry !== "localhost") {
    repository = `${registry}/${repository}`;
    registry = undefined;
  }
  if (!registry || registry === "docker.io" || registry === "index.docker.io") {
    registry = "registry-1.docker.io";
    if (!repository.includes("/")) repository = `library/${repository}`;
  }
  return {
    registry,
    repository,
    tag: match[3] ?? null,
    digest: match[4] ?? null,
  };
}

export function formatImageReference(parsed: ParsedImageReference): string {
  const host = parsed.registry === "registry-1.docker.io" ? "docker.io" : parsed.registry;
  const base = `${host}/${parsed.repository}`;
  if (parsed.digest) return `${base}@${parsed.digest}`;
  return parsed.tag ? `${base}:${parsed.tag}` : base;
}

export function isFloatingTag(tag: string | null): boolean {
  return tag === null || FLOATING_TAGS.has(tag.toLowerCase());
}

/** Parse `Bearer realm="...",service="...",scope="..."` into its parameters. */
export function parseWwwAuthenticate(header: string): Record<string, string> | null {
  if (!/^bearer\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const match of header.slice(7).matchAll(/([a-zA-Z]+)="([^"]*)"/g)) {
    params[match[1]!] = match[2]!;
  }
  return params.realm ? params : null;
}

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const REGISTRY_TIMEOUT_MS = 10_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function imageError(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

/**
 * Confirm the image can be pulled without credentials and return its digest.
 * Follows the registry token challenge anonymously; any 401/403 after that
 * means the image is private (or does not exist, which registries report the
 * same way for anonymous callers).
 */
export async function verifyPublicImage(
  parsed: ParsedImageReference,
  fetchImpl: typeof fetch = fetch,
): Promise<{ digest: string | null }> {
  const reference = parsed.digest ?? parsed.tag ?? "latest";
  const manifestUrl = `https://${parsed.registry}/v2/${parsed.repository}/manifests/${reference}`;
  const display = formatImageReference(parsed);

  const request = (headers: Record<string, string>) =>
    fetchImpl(manifestUrl, {
      method: "HEAD",
      headers: { Accept: MANIFEST_ACCEPT, ...headers },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });

  let response: Response;
  try {
    response = await request({});
    if (response.status === 401) {
      const challenge = parseWwwAuthenticate(response.headers.get("www-authenticate") ?? "");
      if (!challenge)
        throw imageError(`Image ${display} requires credentials; only public images are supported`);
      const tokenUrl = new URL(challenge.realm!);
      if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
      tokenUrl.searchParams.set("scope", challenge.scope ?? `repository:${parsed.repository}:pull`);
      const tokenResponse = await fetchImpl(tokenUrl, {
        signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      });
      if (!tokenResponse.ok) {
        throw imageError(
          `Image ${display} is not publicly pullable (registry refused anonymous access)`,
        );
      }
      const tokenBody = (await tokenResponse.json()) as { token?: string; access_token?: string };
      const token = tokenBody.token ?? tokenBody.access_token;
      if (!token)
        throw imageError(`Image ${display} is not publicly pullable (no anonymous token)`);
      response = await request({ Authorization: `Bearer ${token}` });
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw imageError(
      `Could not reach registry ${parsed.registry} to verify image ${display}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw imageError(
      `Image ${display} is private or does not exist; only public images are supported`,
    );
  }
  if (response.status === 404) {
    throw imageError(`Image ${display} was not found on ${parsed.registry}`);
  }
  if (!response.ok) {
    throw imageError(
      `Registry ${parsed.registry} returned ${response.status} for image ${display}`,
    );
  }
  const digest = response.headers.get("docker-content-digest");
  return { digest: digest && DIGEST_PATTERN.test(digest) ? digest : null };
}

export type ResolvedCustomImage =
  | { kind: "registry"; reference: string }
  | { kind: "e2b-template"; templateId: string };

const E2B_TEMPLATE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Validate a caller-supplied image for the selected provider. Floating tags on
 * registry images are pinned to the digest we verified, so a later restart
 * runs the same image the workspace was created with.
 */
export async function resolveCustomWorkspaceImage(
  image: string,
  providerKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedCustomImage> {
  const kind = customImageKindForProvider(providerKey);
  if (!kind) {
    throw imageError(
      `Provider ${providerKey} does not support custom images. Supported: ${Object.keys(PROVIDER_IMAGE_KIND).join(", ")}`,
    );
  }

  if (kind === "e2b-template") {
    const templateId = image.trim();
    if (!E2B_TEMPLATE_PATTERN.test(templateId)) {
      throw imageError(`"${image}" is not a valid E2B template id or alias`);
    }
    return { kind, templateId };
  }

  const parsed = parseImageReference(image);
  if (!parsed) {
    throw imageError(
      `"${image}" is not a valid image reference. Use registry/name:tag or registry/name@sha256:...`,
    );
  }
  const { digest } = await verifyPublicImage(parsed, fetchImpl);
  if (!parsed.digest && isFloatingTag(parsed.tag) && !digest) {
    throw imageError(
      `Registry ${parsed.registry} did not return a valid digest for floating image ${formatImageReference(parsed)}; use an immutable tag or digest`,
    );
  }
  const pinned =
    !parsed.digest && isFloatingTag(parsed.tag) && digest
      ? { ...parsed, tag: null, digest }
      : parsed;
  return { kind, reference: formatImageReference(pinned) };
}
