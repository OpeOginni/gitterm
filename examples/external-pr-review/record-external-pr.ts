/**
 * Records a before/after visual review of an external GitHub pull request.
 *
 * For each side of the PR (base commit and head commit) the script:
 *   1. creates a disposable Gitterm workspace pinned to that commit,
 *   2. asks an agent to run the app and capture the changed flow with Playwright,
 *   3. uploads every capture to Cloudflare R2 via a helper installed in the sandbox,
 *   4. terminates the workspace.
 *
 * The before/after reports (including the uploaded capture URLs) are printed
 * to the console. See README.md for the required environment variables.
 */

import { createGittermClient, type Workspace } from "@gitterm/sdk";

type GittermClient = ReturnType<typeof createGittermClient>;

type PullRequest = {
  number: number;
  title: string;
  html_url: string;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string; repo: { clone_url: string } | null };
};

type ReviewLabel = "before" | "after";

type Review = {
  label: ReviewLabel;
  commit: string;
  workspaceId?: string;
  status: "completed" | "failed";
  report: string;
  cleanup: "terminated" | "failed" | "not-needed";
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Configuration ----------------------------------------------------------

const repositoryPattern = /^[\w.-]+\/[\w.-]+$/;

const runTimeoutMs = Number(process.env.GITTERM_PR_REVIEW_TIMEOUT_MS ?? 30 * 60_000);
if (!Number.isFinite(runTimeoutMs) || runTimeoutMs < 1_000) {
  throw new Error("GITTERM_PR_REVIEW_TIMEOUT_MS must be at least 1000");
}

// GITTERM_MODEL + GITTERM_MODEL_API_KEY inject a key for these workspaces only;
// leave both unset to use your dashboard credentials.
const model = process.env.GITTERM_MODEL?.trim() || undefined;
const modelApiKey = process.env.GITTERM_MODEL_API_KEY?.trim() || undefined;
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
const modelCredentials =
  model && modelApiKey
    ? [{ providerName: model.slice(0, model.indexOf("/")), apiKey: modelApiKey }]
    : undefined;

const r2 = {
  accountId: requiredEnv("R2_ACCOUNT_ID"),
  accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
  bucket: requiredEnv("R2_BUCKET"),
  secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
  // Optional; when set, uploads print public HTTPS URLs instead of r2:// keys.
  publicUrl: process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, ""),
};

// 4 vCPU / 8 GB sandboxes for app + browser capture.
const provider = { type: "e2b", machine: { type: "profile", key: "large" } } as const;

const reviewId = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
  : crypto.randomUUID();

// --- Sandbox tooling --------------------------------------------------------

// Written into each workspace: a tiny Node script that pushes one file to R2.
const uploadModuleSource = `
import { readFile } from "node:fs/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const [file, key, contentType] = process.argv.slice(2);
const client = new S3Client({
  region: "auto",
  endpoint: "https://" + process.env.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
await client.send(
  new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: await readFile(file),
    ContentType: contentType,
  }),
);
`.trim();

// The command the agent calls to publish a capture; prints the resulting URL.
const uploadCommandSource = `
#!/bin/sh
set -eu
file="$1"
key="\${2:?usage: gitterm-upload-artifact FILE KEY}"
case "$file" in
  *.png) content_type=image/png ;;
  *.jpg | *.jpeg) content_type=image/jpeg ;;
  *.webm) content_type=video/webm ;;
  *.mp4) content_type=video/mp4 ;;
  *) content_type=application/octet-stream ;;
esac
node "$HOME/.gitterm/review-tools/upload-r2.mjs" "$file" "$key" "$content_type"
if [ -n "\${R2_PUBLIC_URL:-}" ]; then
  printf '%s/%s\\n' "\${R2_PUBLIC_URL%/}" "$key"
else
  printf 'r2://%s/%s\\n' "$R2_BUCKET" "$key"
fi
`.trim();

// Runs while each workspace boots: installs Playwright + Chromium and the
// upload helper above.
const reviewToolsSetup = `
set -eu
TOOLS_DIR="$HOME/.gitterm/review-tools"
mkdir -p "$TOOLS_DIR" "$HOME/.local/bin"
npm install --prefix "$TOOLS_DIR" @aws-sdk/client-s3 playwright
"$TOOLS_DIR/node_modules/.bin/playwright" install --with-deps chromium

cat > "$TOOLS_DIR/upload-r2.mjs" <<'UPLOAD_MODULE'
${uploadModuleSource}
UPLOAD_MODULE

cat > "$HOME/.local/bin/gitterm-upload-artifact" <<'UPLOAD_SCRIPT'
${uploadCommandSource}
UPLOAD_SCRIPT
chmod +x "$HOME/.local/bin/gitterm-upload-artifact"
`.trim();

// --- Review flow ------------------------------------------------------------

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
  label: ReviewLabel;
  instructions: string;
}): string {
  return `You are capturing the "${label}" half of a before/after visual for ${repository} pull request #${pullRequest.number}: ${pullRequest.title}. This workspace is checked out at the ${label} revision.

Your required workflow:
1. Inspect the repository and identify the user-facing flow changed by this PR.
2. Install dependencies and run the app using mock or seeded data only. Do not use production services.
3. Playwright and Chromium are already installed and ready to use. Use them to capture at least one useful screenshot or short recording of the changed flow. Save captures under \`/tmp/gitterm-review/${label}\`.
4. Upload every capture immediately with \`~/.local/bin/gitterm-upload-artifact FILE KEY\`, using keys under \`external-pr-reviews/\${REVIEW_ID}/${label}/\`. The command prints the public URL; record each URL.
5. Reply with a concise summary and every uploaded URL. If capture or upload fails, explain the exact reason and continue with any other useful capture.

Do not create commits, pull requests, or GitHub changes. Do not print, inspect, or modify the R2 credentials; the upload helper handles them.

Additional instructions from the workflow operator:
${instructions}`;
}

async function terminateWorkspace(
  client: GittermClient,
  label: ReviewLabel,
  workspace: Workspace | undefined,
): Promise<Review["cleanup"]> {
  if (!workspace) return "not-needed";
  try {
    await client.workspaces.terminate(workspace.id);
    return "terminated";
  } catch (error) {
    console.error(`Could not terminate ${label} workspace ${workspace.id}: ${errorMessage(error)}`);
    return "failed";
  }
}

async function reviewRevision({
  client,
  repository,
  pullRequest,
  label,
  commit,
  instructions,
}: {
  client: GittermClient;
  repository: string;
  pullRequest: PullRequest;
  label: ReviewLabel;
  commit: string;
  instructions: string;
}): Promise<Review> {
  console.log(`Starting ${label} review at ${commit}`);

  // The head branch of an external PR lives in the contributor's fork.
  const repoUrl =
    label === "after"
      ? (pullRequest.head.repo?.clone_url ?? `https://github.com/${repository}.git`)
      : `https://github.com/${repository}.git`;

  let workspace: Workspace | undefined;
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
        R2_ACCOUNT_ID: r2.accountId,
        R2_ACCESS_KEY_ID: r2.accessKeyId,
        R2_BUCKET: r2.bucket,
        R2_SECRET_ACCESS_KEY: r2.secretAccessKey,
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

    return {
      label,
      commit,
      workspaceId: workspace.id,
      status: "completed",
      report: completed.finalText ?? "The agent completed without a final report.",
      cleanup: await terminateWorkspace(client, label, workspace),
    };
  } catch (error) {
    console.error(`${label} review failed: ${errorMessage(error)}`);
    return {
      label,
      commit,
      workspaceId: workspace?.id,
      status: "failed",
      report: errorMessage(error),
      cleanup: await terminateWorkspace(client, label, workspace),
    };
  }
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
  const instructions =
    process.env.GITTERM_PROMPT?.trim() || "Review the most relevant user-facing change.";

  const pullRequest = await getPullRequest(repository, pullRequestNumber);
  const client = createGittermClient({
    token: requiredEnv("GITTERM_API_TOKEN"),
  });

  console.log(`Reviewing ${repository}#${pullRequest.number}`);
  const revisions = [
    { label: "before" as const, commit: pullRequest.base.sha },
    { label: "after" as const, commit: pullRequest.head.sha },
  ];
  const settledReviews = await Promise.allSettled(
    revisions.map((revision) =>
      reviewRevision({
        client,
        repository,
        pullRequest,
        label: revision.label,
        commit: revision.commit,
        instructions,
      }),
    ),
  );
  const reviews: Review[] = settledReviews.map((result, index) => {
    const revision = revisions[index]!;
    if (result.status === "fulfilled") return result.value;
    const report = errorMessage(result.reason);
    console.error(`${revision.label} review crashed: ${report}`);
    return {
      label: revision.label,
      commit: revision.commit,
      status: "failed",
      report,
      cleanup: "failed",
    };
  });

  console.log(`\n${asMarkdown(pullRequest, reviews)}`);

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
