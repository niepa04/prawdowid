const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error(
    '[DEPLOY] Brak wymaganych zmiennych środowiskowych w .env (DISCORD_TOKEN, CLIENT_ID, GUILD_ID).'
  );
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  } else {
    console.warn(`[DEPLOY] Pominięto ${file} – brak właściwości "data" lub "execute".`);
  }
}

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(`[DEPLOY] Rejestrowanie ${commands.length} komend slash dla serwera (GUILD_ID)...`);

    const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });

    console.log(
      `[DEPLOY] Pomyślnie zarejestrowano ${data.length} komend: ${data.map((c) => '/' + c.name).join(', ')}`
    );
  } catch (err) {
    console.error('[DEPLOY] Błąd podczas rejestracji komend:', err.message);
    process.exitCode = 1;
  }
})();
