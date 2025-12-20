import { Client, GatewayIntentBits } from 'discord.js';
import "dotenv/config";


const discordClient = new Client({ intents: [] })



export async function sendAdminMessage(message: string) {
    await discordClient.login(process.env.DISCORD_TOKEN as string);

    const user = await discordClient.users.fetch(process.env.DISCORD_DM_CHANNEL_ID as string);

    await user.createDM(true)
    await user.send(message);
}
