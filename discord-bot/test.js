require('dotenv').config();

console.log("TOKEN:", process.env.DISCORD_TOKEN ? "OK" : "BRAK");
console.log("CLIENT_ID:", process.env.CLIENT_ID ? "OK" : "BRAK");
console.log("GUILD_ID:", process.env.GUILD_ID ? "OK" : "BRAK");