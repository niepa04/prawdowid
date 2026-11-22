const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const express = require('express');
const createMessengerRouter = require('./messengerRoutes');

const PORT = Number(process.env.PORT) || 3001;
const app = express();

app.disable('x-powered-by');
app.use(createMessengerRouter());

app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'koma-messenger-bot' });
});

app.use((_req, res) => {
  res.status(404).json({ blad: 'Nie znaleziono.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[MESSENGER-BOT] Webhook działa na http://localhost:${PORT}/webhook`);
    console.log(`[MESSENGER-BOT] Backend KOMA: ${process.env.KOMA_API_URL || 'http://localhost:3000'}`);
  });
}

module.exports = app;
