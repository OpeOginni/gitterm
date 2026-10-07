/** Reproducible dashboard definitions for the schema-v2 instrumentation. No credentials. */
const tags = ["wizard", "gitterm-v2"];
const event = (name: string, math = "total", extra: Record<string, unknown> = {}) => ({
  kind: "EventsNode",
  event: name,
  math,
  ...extra,
});
const trends = (series: object[], breakdown?: string, options: Record<string, unknown> = {}) => ({
  kind: "InsightVizNode",
  source: {
    kind: "TrendsQuery",
    series,
    interval: "day",
    dateRange: { date_from: "-30d" },
    filterTestAccounts: true,
    trendsFilter: { display: "ActionsLineGraph", showLegend: true },
    ...(breakdown
      ? { breakdownFilter: { breakdowns: [{ type: "event", property: breakdown }] } }
      : {}),
    ...options,
  },
});
const funnel = (events: string[], window: number, unit = "day") => ({
  kind: "InsightVizNode",
  source: {
    kind: "FunnelsQuery",
    series: events.map((name) => ({ kind: "EventsNode", event: name })),
    dateRange: { date_from: "-30d" },
    filterTestAccounts: true,
    funnelsFilter: {
      funnelVizType: "steps",
      funnelOrderType: "ordered",
      funnelWindowInterval: window,
      funnelWindowIntervalUnit: unit,
    },
  },
});
const insight = (name: string, description: string, query: object) => ({
  name: `${name} (wizard)`,
  description,
  query,
  tags,
});

export const dashboardDefinitions = [
  {
    name: "Analytics basics (wizard)",
    pinned: true,
    tags,
    description:
      "Activation and checkout handoffs — schema v2. Consented browser traffic only; excludes the existing internal/test cohort. These charts await deployment and do not count verified revenue or agent runs.",
    note: "## Activation & conversion\nSchema v2 only; charts fill after deployment. Browser metrics cover consenting users, not all customers. Internal/test cohort excluded. Funnels count people, not individual workspace attempts. API accepted ≠ ready; connection handoff ≠ agent usage; checkout return ≠ payment. No authoritative run retention, revenue or churn yet.",
    insights: [
      insight(
        "Sign-in completion",
        "People starting and completing email/GitHub sign-in within one hour. Includes only consented attempts recorded by this browser; not total signups.",
        funnel(["auth_started", "auth_completed"], 1, "hour"),
      ),
      insight(
        "Workspace activation funnel",
        "People requesting a workspace, API acceptance, observed readiness, then a connection handoff within 24 hours. Not per-workspace matching or proof of agent work.",
        funnel(
          [
            "workspace_create_started",
            "workspace_create_succeeded",
            "workspace_ready",
            "workspace_connection_requested",
          ],
          24,
          "hour",
        ),
      ),
      insight(
        "Trial outcomes",
        "Anonymous trial attempts, successful responses and failures per day. Success is a trial launch response, not verified agent use.",
        trends([event("trial_started"), event("trial_succeeded"), event("trial_failed")]),
      ),
      insight(
        "Daily workspace handoff users",
        "Distinct consenting people requesting a browser/desktop/CLI/editor handoff each day. This is an engagement proxy, not actual connected-agent DAU.",
        trends([event("workspace_connection_requested", "dau")]),
      ),
      insight(
        "Checkout return funnel — not paid conversion",
        "People starting checkout and returning to its success route within one day. Does not verify payment, revenue or subscription status. Billing webhooks remain authoritative.",
        funnel(["checkout_started", "checkout_returned"], 1),
      ),
    ],
  },
  {
    name: "Workspace reliability (wizard)",
    pinned: true,
    tags,
    description:
      "Browser-observed workspace request outcomes, latency and sanitized exceptions. Schema v2; internal/test cohort excluded. These are not server-wide provisioning SLAs.",
    note: "## Reliability\nCounts cover consenting browsers. Request acceptance is separate from provisioning. Readiness latency starts when the post-create subscription opens; leaving the page loses observation. Failure categories are safe transport codes, not raw messages. Exceptions redact messages, breadcrumbs, local variables and non-bundle paths. Server reports use a service identity; error users are browser-only.",
    insights: [
      insight(
        "Workspace request outcomes by cloud",
        "Accepted and failed creation requests by cloud provider. Compare outcomes without treating acceptance as provisioning success.",
        trends([event("workspace_create_succeeded"), event("workspace_create_failed")], "provider"),
      ),
      insight(
        "Workspace failure categories",
        "Workspace creation failures by safe transport category. Expected validation/quota/auth errors remain here, not in exception tracking.",
        trends([event("workspace_create_failed")], "error_code"),
      ),
      insight(
        "Observed readiness latency — median & p95",
        "Median and p95 browser-observed wait_ms after API acceptance. Missing observations are not failures. Measured in milliseconds, not a provider SLA.",
        trends(
          [
            event("workspace_ready", "median", { math_property: "wait_ms" }),
            event("workspace_ready", "p95", { math_property: "wait_ms" }),
          ],
          undefined,
          {
            trendsFilter: {
              display: "ActionsLineGraph",
              showLegend: true,
              aggregationAxisFormat: "duration_ms",
            },
          },
        ),
      ),
      insight(
        "Workspace request latency — median & p95",
        "Median and p95 duration_ms of accepted create requests. Does not include subsequent provisioning wait.",
        trends(
          [
            event("workspace_create_succeeded", "median", { math_property: "duration_ms" }),
            event("workspace_create_succeeded", "p95", { math_property: "duration_ms" }),
          ],
          undefined,
          {
            trendsFilter: {
              display: "ActionsLineGraph",
              showLegend: true,
              aggregationAxisFormat: "duration_ms",
            },
          },
        ),
      ),
      insight(
        "Unexpected exceptions & affected browser users",
        "Exception occurrences by service plus distinct web users with errors. Server service identity is deliberately excluded from affected-user counts. Open Error Tracking for grouped issues.",
        trends(
          [
            event("$exception"),
            event("$exception", "dau", {
              properties: [{ key: "service", type: "event", operator: "exact", value: "web" }],
              name: "Affected browser users",
            }),
          ],
          "service",
        ),
      ),
    ],
  },
  {
    name: "Integration & feature adoption (wizard)",
    pinned: true,
    tags,
    description:
      "New integrations, model-provider connections, cloud demand, workspace handoff methods and bot creation. Schema v2; consenting users and internal/test cohort exclusion only.",
    note: "## Adoption\nNew additions only, not settings visits or edits. An integration addition means persisted configuration, not a passing connection test. Model-provider events record successful setup, never keys. Cloud demand uses accepted workspace requests. Bot creation is configuration, not a running or engaged bot. Use these views to prioritize support and onboarding.",
    insights: [
      insight(
        "Integrations added by type",
        "Daily additions of GitHub, Google Cloud, MCP and Executor configurations; no edits or secrets. A saved connection may still need authentication/setup.",
        trends([event("integration_added")], "integration_type"),
      ),
      insight(
        "Model providers connected",
        "Successful saved API-key or OAuth model-provider setups per day, broken down by provider. No key values or account details.",
        trends([event("model_provider_connected")], "provider"),
      ),
      insight(
        "Cloud provider demand",
        "Accepted workspace creation requests by cloud provider. This measures demand, not completed provisioning or compute consumption.",
        trends([event("workspace_create_succeeded")], "provider"),
      ),
      insight(
        "Workspace handoff methods",
        "Browser, desktop, CLI and editor connection handoffs per day. Not a count of successful connections or agent runs.",
        trends([event("workspace_connection_requested")], "method"),
      ),
      insight(
        "Bots created by platform",
        "New saved Slack and Discord bot configurations. Does not imply bot deployment or message activity.",
        trends([event("bot_created")], "platform"),
      ),
    ],
  },
];
