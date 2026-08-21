import { mkdir } from "node:fs/promises";

import { createGittermClient, type Workspace } from "@gitterm/sdk";

type PullRequest = {
  number: number;
  title: string;
  html_url: string;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
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
// Optional: GITTERM_MODEL ("provider/model") picks the model for each run, and
// GITTERM_MODEL_API_KEY supplies that provider's key inline — it only lives
// inside the disposable workspaces, never in the Gitterm dashboard. Leave both
// unset to use your dashboard credentials.
const model = process.env.GITTERM_MODEL?.trim() || undefined;
const modelApiKey = process.env.GITTERM_MODEL_API_KEY?.trim() || undefined;
const modelCredentials =
  model && modelApiKey
    ? [{ providerName: model.slice(0, model.indexOf("/")), apiKey: modelApiKey }]
    : undefined;
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

Set up and run the application (prefer mock or seeded data), then capture the flow the PR changes as a screenshot or short recording using the available browser tooling. Do not create commits, pull requests, or any GitHub changes, and do not use secrets or production services.

Reply with the local paths of your captures and one or two sentences on what they show. If you could not capture, say why.

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

  try {
    const created = await client.workspaces.create({
      idempotencyKey: `external-pr-review-${reviewId}-${label}`,
      name: `PR #${pullRequest.number} ${label}`,
      repo: `https://github.com/${repository}.git`,
      branch: label === "before" ? pullRequest.base.ref : pullRequest.head.ref,
      baseCommit: commit,
      checkoutRef: commit,
      persistent: false,
      modelCredentials,
    });
    workspace = created.workspace;

    const run = await client.runs.create({
      workspaceId: workspace.id,
      idempotencyKey: `external-pr-review-run-${reviewId}-${label}`,
      title: `PR #${pullRequest.number} ${label} visual review`,
      model,
      waitForSetup: true,
      setupTimeoutMs: runTimeoutMs,
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
  const reviews = await Promise.all([
    reviewRevision({
      client,
      repository,
      pullRequest,
      label: "before",
      commit: pullRequest.base.sha,
      instructions,
    }),
    reviewRevision({
      client,
      repository,
      pullRequest,
      label: "after",
      commit: pullRequest.head.sha,
      instructions,
    }),
  ]);

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
