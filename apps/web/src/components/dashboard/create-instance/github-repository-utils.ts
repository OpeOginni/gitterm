export interface ParsedGitHubRepositoryInput {
  owner: string;
  repo: string;
  fullName: string;
  normalizedUrl: string;
  branchFromUrl?: string;
}

function sanitizePathPart(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return decodeURIComponent(value).trim();
}

export function parseGitHubRepositoryInput(
  input: string,
): ParsedGitHubRepositoryInput | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return null;
  }

  const sshMatch = trimmedInput.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    const owner = sanitizePathPart(sshMatch[1]);
    const repo = sanitizePathPart(sshMatch[2]);

    if (!owner || !repo) {
      return null;
    }

    return {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      normalizedUrl: `https://github.com/${owner}/${repo}`,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedInput);
  } catch {
    return null;
  }

  if (parsedUrl.hostname !== "github.com" && parsedUrl.hostname !== "www.github.com") {
    return null;
  }

  const pathParts = parsedUrl.pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => sanitizePathPart(part));

  const owner = pathParts[0];
  const rawRepo = pathParts[1]?.replace(/\.git$/i, "");

  if (!owner || !rawRepo) {
    return null;
  }

  const branchFromUrl =
    pathParts[2] === "tree" && pathParts.length > 3
      ? pathParts.slice(3).filter(Boolean).join("/")
      : undefined;

  return {
    owner,
    repo: rawRepo,
    fullName: `${owner}/${rawRepo}`,
    normalizedUrl: `https://github.com/${owner}/${rawRepo}`,
    branchFromUrl: branchFromUrl || undefined,
  };
}

export function normalizeGitHubRepositoryUrl(input: string): string {
  return parseGitHubRepositoryInput(input)?.normalizedUrl ?? input.trim().replace(/\.git\/?$/i, "");
}
