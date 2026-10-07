/**
 * A Slack app manifest with exactly what the bot uses. Paste it at api.slack.com/apps →
 * Create New App → From a manifest.
 */
export function slackManifest(name = "GitTerm Agent") {
  return {
    display_information: {
      name,
      description: "A coding agent for your repository, running in a GitTerm sandbox",
    },
    features: {
      bot_user: { display_name: name, always_online: true },
      // Lets people DM the bot; each DM gets its own sandbox.
      app_home: { messages_tab_enabled: true },
    },
    oauth_config: {
      scopes: {
        bot: [
          "app_mentions:read",
          "channels:history",
          "groups:history",
          "im:history",
          "chat:write",
          "files:read",
          "reactions:write",
          "users:read",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: ["app_mention", "message.channels", "message.groups", "message.im"],
      },
      interactivity: { is_enabled: true },
      socket_mode_enabled: true,
    },
  };
}
