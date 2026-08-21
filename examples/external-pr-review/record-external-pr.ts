import { mkdir } from "node:fs/promises";

import { createGittermClient, type Workspace } from "@gitterm/sdk";

type PullRequest = {
  number: number;
  title: string;
  html_url: string;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string; repo: { clone_url: string } | null };
};

type Review = {
  label: "before" | "after";
  commit: string;
  workspaceId?: string;
  status: "completed" | "failed";
  report: string;
  cleanup: "terminated" | "failed" | "not-needed";
};

const repositoryPattern = /^[\w.-]+\/[\w.-]+$/;
const runTimeoutMs = Number(process.env.GITTERM_PR_REVIEW_TIMEOUT_MS ?? 30 * 60_000);
// GITTERM_MODEL + GITTERM_MODEL_API_KEY inject a key for these workspaces only;
// leave both unset to use your dashboard credentials.
const model = process.env.GITTERM_MODEL?.trim() || undefined;
const modelApiKey = process.env.GITTERM_MODEL_API_KEY?.trim() || undefined;
const modelCredentials =
  model && modelApiKey
    ? [{ providerName: model.slice(0, model.indexOf("/")), apiKey: modelApiKey }]
    : undefined;
const r2 = {
  accountId: process.env.R2_ACCOUNT_ID?.trim(),
  apiToken: process.env.R2_API_TOKEN?.trim(),
  bucket: process.env.R2_BUCKET?.trim(),
  publicUrl: process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, ""),
};
const reviewToolsSetup = [
  "set -eu",
  'TOOLS_DIR="$HOME/.gitterm/review-tools"',
  'mkdir -p "$TOOLS_DIR" "$HOME/.local/bin"',
  'npm install --prefix "$TOOLS_DIR" wrangler playwright',
  '"$TOOLS_DIR/node_modules/.bin/playwright" install --with-deps chromium',
  "cat > \"$HOME/.local/bin/gitterm-upload-artifact\" <<'UPLOAD_SCRIPT'",
  "#!/bin/sh",
  "set -eu",
  'file="$1"',
  'key="${2:?usage: gitterm-upload-artifact FILE KEY}"',
  'case "$file" in *.png) content_type=image/png ;; *.jpg|*.jpeg) content_type=image/jpeg ;; *.webm) content_type=video/webm ;; *.mp4) content_type=video/mp4 ;; *) content_type=application/octet-stream ;; esac',
  '"$HOME/.gitterm/review-tools/node_modules/.bin/wrangler" r2 object put "$R2_BUCKET/$key" --file "$file" --remote --content-type "$content_type" >/dev/null',
  'if [ -n "${R2_PUBLIC_URL:-}" ]; then printf \'%s/%s\\n\' "${R2_PUBLIC_URL%/}" "$key"; else printf \'r2://%s/%s\\n\' "$R2_BUCKET" "$key"; fi',
  "UPLOAD_SCRIPT",
  'chmod +x "$HOME/.local/bin/gitterm-upload-artifact"',
].join("\n");
// 4 vCPU / 8 GB sandboxes for app + browser capture.
const provider = { type: "e2b", machine: { type: "profile", key: "large" } } as const;
const reviewId = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
  : crypto.randomUUID();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getPullRequest(repository: string, number: number): Promise<PullRequest> {
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${number}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "gitterm-external-pr-review",
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub could not read ${repository}#${number}: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as PullRequest;
}

function buildPrompt({
  repository,
  pullRequest,
  label,
  instructions,
}: {
  repository: string;
  pullRequest: PullRequest;
  label: "before" | "after";
  instructions: string;
}): string {
  return `You are capturing the "${label}" half of a before/after visual for ${repository} pull request #${pullRequest.number}: ${pullRequest.title}. This workspace is checked out at the ${label} revision.

Your required workflow:
1. Inspect the repository and identify the user-facing flow changed by this PR.
2. Install dependencies and run the app using mock or seeded data only. Do not use production services.
3. Use Playwright with Chromium to capture at least one useful screenshot or short recording of the changed flow. Save captures under \`/tmp/gitterm-review/${label}\`.
4. Upload every capture immediately with \`~/.local/bin/gitterm-upload-artifact FILE KEY\`, using keys under \`external-pr-reviews/\${REVIEW_ID}/${label}/\`. The command prints the public URL; record each URL.
5. Reply with a concise summary and every uploaded URL. If capture or upload fails, explain the exact reason and continue with any other useful capture.

Do not create commits, pull requests, or GitHub changes. Do not print, inspect, or modify the R2 credentials; the upload helper handles them.

Additional instructions from the workflow operator:
${instructions}`;
}

async function reviewRevision({
  client,
  repository,
  pullRequest,
  label,
  commit,
  instructions,
}: {
  client: ReturnType<typeof createGittermClient>;
  repository: string;
  pullRequest: PullRequest;
  label: "before" | "after";
  commit: string;
  instructions: string;
}): Promise<Review> {
  let workspace: Workspace | undefined;
  let cleanup: Review["cleanup"] = "not-needed";
  let review!: Review;
  console.log(`Starting ${label} review at ${commit}`);

  // The head branch of an external PR lives in the contributor's fork.
  const repoUrl =
    label === "after"
      ? (pullRequest.head.repo?.clone_url ?? `https://github.com/${repository}.git`)
      : `https://github.com/${repository}.git`;

  try {
    const created = await client.workspaces.create({
      idempotencyKey: `external-pr-review-${reviewId}-${label}`,
      name: `PR #${pullRequest.number} ${label}`,
      repo: repoUrl,
      branch: label === "before" ? pullRequest.base.ref : pullRequest.head.ref,
      baseCommit: commit,
      persistent: false,
      provider,
      modelCredentials,
      environmentVariables: {
        CLOUDFLARE_ACCOUNT_ID: r2.accountId!,
        CLOUDFLARE_API_TOKEN: r2.apiToken!,
        R2_BUCKET: r2.bucket!,
        REVIEW_ID: reviewId,
        REVIEW_LABEL: label,
        ...(r2.publicUrl ? { R2_PUBLIC_URL: r2.publicUrl } : {}),
      },
      setupCommands: [reviewToolsSetup],
      opencode: {
        // Disposable, unauthenticated sandbox: skip tool approval prompts.
        config: {
          permission: {
            edit: "allow",
            bash: "allow",
            webfetch: "allow",
            external_directory: "allow",
          },
        },
      },
    });
    workspace = created.workspace;

    const run = await client.runs.create({
      workspaceId: workspace.id,
      idempotencyKey: `external-pr-review-run-${reviewId}-${label}`,
      title: `PR #${pullRequest.number} ${label} visual review`,
      model,
      waitForSetup: true,
      setupTimeoutMs: Math.min(runTimeoutMs, 600_000),
      prompt: buildPrompt({ repository, pullRequest, label, instructions }),
    });
    const completed = await client.runs.wait(workspace.id, run.id, { timeoutMs: runTimeoutMs });
    if (completed.status !== "completed") {
      throw new Error(
        `Agent run finished with ${completed.status}: ${completed.error ?? "no error reported"}`,
      );
    }

    review = {
      label,
      commit,
      workspaceId: workspace.id,
      status: "completed",
      report: completed.finalText ?? "The agent completed without a final report.",
      cleanup,
    };
  } catch (error) {
    console.error(`${label} review failed: ${errorMessage(error)}`);
    review = {
      label,
      commit,
      workspaceId: workspace?.id,
      status: "failed",
      report: errorMessage(error),
      cleanup,
    };
  } finally {
    if (workspace) {
      try {
        await client.workspaces.terminate(workspace.id);
        cleanup = "terminated";
      } catch (error) {
        cleanup = "failed";
        console.error(
          `Could not terminate ${label} workspace ${workspace.id}: ${errorMessage(error)}`,
        );
      }
    }
    review.cleanup = cleanup;
  }

  return review;
}

function asMarkdown(pullRequest: PullRequest, reviews: Review[]): string {
  const sections = reviews.map(
    (review) => `## ${review.label === "before" ? "Before" : "After"}

- Commit: \`${review.commit}\`
- Workspace: ${review.workspaceId ? `\`${review.workspaceId}\`` : "not created"}
- Status: ${review.status}
- Cleanup: ${review.cleanup}

${review.report}`,
  );
  return `# Visual PR review: #${pullRequest.number}

[${pullRequest.title}](${pullRequest.html_url})

${sections.join("\n\n")}
`;
}

async function main() {
  const repository = requiredEnv("TARGET_REPOSITORY");
  if (!repositoryPattern.test(repository)) {
    throw new Error("TARGET_REPOSITORY must use the owner/repository format");
  }
  const pullRequestNumber = Number(requiredEnv("TARGET_PR"));
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("TARGET_PR must be a positive integer");
  }
  if (!Number.isFinite(runTimeoutMs) || runTimeoutMs < 1_000) {
    throw new Error("GITTERM_PR_REVIEW_TIMEOUT_MS must be at least 1000");
  }
  if (!r2.accountId) throw new Error("R2_ACCOUNT_ID is required");
  if (!r2.apiToken) throw new Error("R2_API_TOKEN is required");
  if (!r2.bucket) throw new Error("R2_BUCKET is required");
  if (model && !/^[^/]+\/.+$/.test(model)) {
    throw new Error(
      "GITTERM_MODEL must use the provider/model format, e.g. anthropic/claude-sonnet-4-20250514",
    );
  }
  if (modelApiKey && !model) {
    console.warn(
      "GITTERM_MODEL_API_KEY is only used together with GITTERM_MODEL; using dashboard credentials instead.",
    );
  }

  const outputDir = process.env.OUTPUT_DIR?.trim() || "artifacts/external-pr-review";
  const instructions =
    process.env.GITTERM_PROMPT?.trim() || "Review the most relevant user-facing change.";
  const pullRequest = await getPullRequest(repository, pullRequestNumber);
  const client = createGittermClient({
    token: requiredEnv("GITTERM_API_TOKEN"),
  });

  console.log(`Reviewing ${repository}#${pullRequest.number}`);
  const reviews: Review[] = [];
  for (const revision of [
    { label: "before" as const, commit: pullRequest.base.sha },
    { label: "after" as const, commit: pullRequest.head.sha },
  ]) {
    // Run one large browser sandbox at a time to avoid provider capacity races.
    reviews.push(
      await reviewRevision({
        client,
        repository,
        pullRequest,
        label: revision.label,
        commit: revision.commit,
        instructions,
      }),
    );
  }

  await mkdir(outputDir, { recursive: true });
  await Bun.write(
    `${outputDir}/review.json`,
    JSON.stringify({ repository, pullRequest, reviews }, null, 2),
  );
  await Bun.write(`${outputDir}/review.md`, asMarkdown(pullRequest, reviews));

  const failures = reviews.filter(
    (review) => review.status === "failed" || review.cleanup === "failed",
  );
  if (failures.length > 0) {
    throw new Error(
      `${failures.map((review) => review.label).join(" and ")} review or cleanup failed`,
    );
  }
}

await main();
