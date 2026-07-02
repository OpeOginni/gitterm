import { createElement } from "react";
import env from "@gitterm/env/server";
import { render } from "@react-email/components";
import { InviteEmail, type InviteEmailProps } from "./templates/invite-email";
import { getBaseUrl } from "../../utils/routing";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

async function renderInviteEmail(
  props: InviteEmailProps,
): Promise<{ html: string; text: string }> {
  const element = createElement(InviteEmail, props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}

interface WorkspaceInviteEmailInput {
  inviterName: string;
  inviterEmail: string;
  workspaceName: string;
  repositoryUrl?: string | null;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}

interface TeamInviteEmailInput {
  inviterName: string;
  inviterEmail: string;
  teamName: string;
  acceptUrl: string;
  expiresAt: Date;
}

const PROD_WEB_URL = "https://gitterm.dev";

function publicWebUrl(): string {
  return getBaseUrl().replace(/\/$/, "");
}

function assetOrigin(): string {
  const base = env.BASE_URL;
  if (base && !base.includes("localhost") && !base.includes("127.0.0.1")) {
    return base.replace(/\/$/, "");
  }
  return PROD_WEB_URL;
}

export function buildInviteUrl(params: {
  token: string;
  type: "workspace" | "team";
}): string {
  const url = new URL(`${publicWebUrl()}/invite`);
  url.searchParams.set("token", params.token);
  url.searchParams.set("type", params.type);
  return url.toString();
}

function formatExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(expiresAt);
}

function logoUrl(): string {
  return `${assetOrigin()}/favicon_io/apple-touch-icon.png`;
}

function githubIconUrl(): string {
  return `${assetOrigin()}/github-mark-white.png`;
}

export async function renderWorkspaceInviteEmail(
  input: WorkspaceInviteEmailInput,
): Promise<RenderedEmail> {
  const { html, text } = await renderInviteEmail({
    preheader: `${input.inviterName} invited you to ${input.workspaceName} on GitTerm.`,
    eyebrow: "Workspace invite",
    subjectName: input.workspaceName,
    inviterName: input.inviterName,
    inviterEmail: input.inviterEmail,
    role: input.role,
    repositoryUrl: input.repositoryUrl,
    blurb: "Accept to open this workspace and start working in it.",
    ctaLabel: "Accept invite",
    ctaUrl: input.acceptUrl,
    expiresLabel: formatExpiry(input.expiresAt),
    logoUrl: logoUrl(),
    githubIconUrl: githubIconUrl(),
  });

  return {
    subject: `${input.inviterName} invited you to ${input.workspaceName}`,
    html,
    text,
  };
}

export async function renderTeamInviteEmail(
  input: TeamInviteEmailInput,
): Promise<RenderedEmail> {
  const { html, text } = await renderInviteEmail({
    preheader: `${input.inviterName} invited you to the ${input.teamName} team on GitTerm.`,
    eyebrow: "Team invite",
    subjectName: input.teamName,
    inviterName: input.inviterName,
    inviterEmail: input.inviterEmail,
    blurb:
      "Joining gives you access to every workspace shared with this team. You only need to accept once.",
    ctaLabel: "Accept invite",
    ctaUrl: input.acceptUrl,
    expiresLabel: formatExpiry(input.expiresAt),
    logoUrl: logoUrl(),
    githubIconUrl: githubIconUrl(),
  });

  return {
    subject: `${input.inviterName} invited you to the ${input.teamName} team`,
    html,
    text,
  };
}
