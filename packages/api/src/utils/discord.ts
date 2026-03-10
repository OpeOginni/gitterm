import { Client } from "discord.js";
import env from "@gitterm/env/server";

const discordClient = new Client({ intents: [] });

export async function sendAdminMessage(message: string) {
  if (!env.DISCORD_TOKEN) {
    console.warn("[discord] DISCORD_TOKEN not set, skipping message");
    return;
  }
  if (!env.DISCORD_DM_CHANNEL_ID) {
    console.warn("[discord] DISCORD_DM_CHANNEL_ID not set, skipping message");
    return;
  }

  await discordClient.login(env.DISCORD_TOKEN);

  const user = await discordClient.users.fetch(env.DISCORD_DM_CHANNEL_ID);

  await user.createDM(true);
  await user.send(message);
}

interface WorkspaceNotificationData {
  domain: string;
  subdomain: string;
  workspaceId: string;
  status: string;
  hostingType: string;
  persistent: boolean;
  serverOnly: boolean;
  userName: string | null;
  userEmail: string;
  agentTypeName: string;
  cloudProviderName: string;
  regionName: string;
  regionExternalIdentifier: string;
  repoUrl?: string | null;
  serviceCreatedAt: string | Date;
  upstreamUrl: string | null;
}

export function sendWorkspaceCreatedNotification(data: WorkspaceNotificationData) {
  const workspaceDetails = [
    `🚀 **New Workspace Created**`,
    ``,
    `**Workspace Info:**`,
    `• Domain: \`${data.domain}\``,
    `• Subdomain: \`${data.subdomain}\``,
    `• Workspace ID: \`${data.workspaceId}\``,
    `• Status: \`${data.status}\``,
    `• Hosting Type: \`${data.hostingType}\``,
    `• Persistent: ${data.persistent ? "✅ Yes" : "❌ No"}`,
    `• Server Only: ${data.serverOnly ? "✅ Yes" : "❌ No"}`,
    ``,
    `**User Info:**`,
    `• Name: \`${data.userName || "N/A"}\``,
    `• Email: \`${data.userEmail}\``,
    ``,
    `**Configuration:**`,
    `• Agent Type: \`${data.agentTypeName}\``,
    `• Cloud Provider: \`${data.cloudProviderName}\``,
    `• Region: \`${data.regionName} (${data.regionExternalIdentifier})\``,
    ``,
  ];

  if (data.repoUrl) {
    workspaceDetails.push(`**Repository:**`, `• URL: \`${data.repoUrl}\``, ``);
  }

  workspaceDetails.push(
    `**Timestamps:**`,
    `• Created: \`${new Date(data.serviceCreatedAt).toISOString()}\``,
    `• Upstream URL: \`${data.upstreamUrl || "N/A"}\``,
  );

  sendAdminMessage(workspaceDetails.join("\n"));
}
