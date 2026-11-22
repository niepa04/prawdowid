const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { Client, Collection, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { getBackendUrl } = require('./services/komaApi');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[BOT] Brak DISCORD_TOKEN w pliku .env. Uzupełnij konfigurację przed uruchomieniem.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[BOT] Pominięto ${file} – brak właściwości "data" lub "execute".`);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[BOT] Zalogowano jako ${readyClient.user.tag}`);
  console.log(`[BOT] Załadowano komend: ${client.commands.size} (${[...client.commands.keys()].map((k) => '/' + k).join(', ')})`);
  console.log(`[BOT] Adres backendu KOMA: ${getBackendUrl()}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[BOT] Nieznana komenda: /${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[BOT] Błąd podczas wykonywania /${interaction.commandName}:`, err.message);

    const errorContent = 'Wystąpił nieoczekiwany błąd podczas wykonywania tej komendy. Spróbuj ponownie później.';
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorContent, embeds: [] });
      } else {
        await interaction.reply({ content: errorContent, flags: MessageFlags.Ephemeral });
      }
    } catch (replyErr) {
      console.error('[BOT] Nie udało się wysłać komunikatu o błędzie do użytkownika:', replyErr.message);
    }
  }
});

client.on(Events.Error, (err) => {
  console.error('[BOT] Błąd klienta Discord:', err.message);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[BOT] Nieobsłużone odrzucenie obietnicy (unhandledRejection):', msg);
});

client.login(token).catch((err) => {
  console.error('[BOT] Nie udało się zalogować do Discorda:', err.message);
  process.exit(1);
});
