// messengerController.js - Kontroler HTTP dla GET /webhook oraz POST /webhook
const crypto = require('node:crypto');
const { verifyWebhookSignature, extractMessagingEvents } = require('./messengerService');
const { handleIncomingEvent } = require('./messageHandler');

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!mode || !token || !challenge) {
    return res.status(400).json({ blad: 'Brak wymaganych parametrów weryfikacji (hub.mode, hub.verify_token, hub.challenge).' });
  }

  const expectedToken = process.env.VERIFY_TOKEN;
  if (!expectedToken) {
    return res.status(500).json({ blad: 'Serwer nie ma skonfigurowanej zmiennej VERIFY_TOKEN.' });
  }

  if (mode === 'subscribe' && timingSafeStringEqual(token, expectedToken)) {
    return res.status(200).type('text/plain').send(String(challenge));
  }

  return res.status(403).json({ blad: 'Niepoprawny token weryfikacyjny.' });
}

function createWebhookPostHandler(deps = {}) {
  const eventHandler = deps.eventHandler || handleIncomingEvent;

  return function handleWebhookPost(req, res) {
    const signature = req.get('X-Hub-Signature-256');
    const isValidSig = verifyWebhookSignature(req.rawBody, signature);

    if (!isValidSig) {
      return res.status(403).json({ blad: 'Niepoprawny lub brakujący podpis X-Hub-Signature-256.' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.object !== 'page' || !Array.isArray(body.entry)) {
      return res.status(400).json({ blad: 'Niepoprawny payload zdarzenia Messenger.' });
    }

    res.status(200).type('text/plain').send('EVENT_RECEIVED');

    const events = extractMessagingEvents(body);
    if (events.length > 0) {
      setImmediate(() => {
        Promise.allSettled(events.map((ev) => eventHandler(ev, deps))).catch((err) => {
          console.error('[MESSENGER] Nieoczekiwany błąd kolejki zdarzeń:', err.message);
        });
      });
    }
  };
}

module.exports = {
  verifyWebhook,
  createWebhookPostHandler,
};
