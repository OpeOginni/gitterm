import { Client, GatewayIntentBits } from 'discord.js';
import env from "@gitterm/env/server";


const discordClient = new Client({ intents: [] })

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

    await user.createDM(true)
    await user.send(message);
}
