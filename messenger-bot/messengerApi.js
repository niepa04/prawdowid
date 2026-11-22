// messengerApi.js - Klient Meta Graph API (Send API) dla Facebook Messenger

const DEFAULT_GRAPH_API_VERSION = 'v21.0';
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_TIMEOUT_MS = 15000;

class MessengerApiError extends Error {
  constructor(message, { status = null, metaCode = null, isRateLimit = false } = {}) {
    super(message);
    this.name = 'MessengerApiError';
    this.status = status;
    this.metaCode = metaCode;
    this.isRateLimit = isRateLimit;
  }
}

function splitMessageForMessenger(text, maxLen = MAX_MESSAGE_LENGTH) {
  const str = String(text || '').trim();
  if (!str) return [];
  if (str.length <= maxLen) return [str];

  const chunks = [];
  let remaining = str;

  while (remaining.length > maxLen) {
    let sliceEnd = remaining.lastIndexOf('\n', maxLen);
    if (sliceEnd < Math.floor(maxLen * 0.4)) {
      sliceEnd = remaining.lastIndexOf(' ', maxLen);
    }
    if (sliceEnd < Math.floor(maxLen * 0.4)) {
      sliceEnd = maxLen;
    }
    chunks.push(remaining.slice(0, sliceEnd).trimEnd());
    remaining = remaining.slice(sliceEnd).trimStart();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

async function sendSingleMessage(psid, text, options = {}) {
  const token = options.pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    throw new MessengerApiError('Brak skonfigurowanego PAGE_ACCESS_TOKEN.', { status: 500 });
  }

  const version = options.graphVersion || DEFAULT_GRAPH_API_VERSION;
  const endpoint = `https://graph.facebook.com/${version}/me/messages`;
  const fetchFn = options.fetchImpl || fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { id: String(psid) },
        messaging_type: 'RESPONSE',
        message: { text: String(text) },
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const metaCode = data?.error?.code ?? null;
      const isRateLimit = response.status === 429 || [4, 17, 32, 613].includes(metaCode);
      const errMsg = data?.error?.message || `Błąd Meta Graph API (HTTP ${response.status})`;
      throw new MessengerApiError(errMsg, {
        status: response.status,
        metaCode,
        isRateLimit,
      });
    }

    return data;
  } catch (err) {
    if (err instanceof MessengerApiError) throw err;
    if (err.name === 'AbortError') {
      throw new MessengerApiError('Przekroczono limit czasu połączenia z Meta Graph API.', {
        status: 504,
      });
    }
    throw new MessengerApiError(`Błąd sieciowy podczas wysyłania wiadomości do Meta: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function sendTextMessage(psid, text, options = {}) {
  if (!psid) {
    throw new MessengerApiError('Brak identyfikatora odbiorcy (PSID).', { status: 400 });
  }
  const chunks = splitMessageForMessenger(text, options.maxLen || MAX_MESSAGE_LENGTH);
  if (chunks.length === 0) {
    throw new MessengerApiError('Treść wiadomości do wysłania jest pusta.', { status: 400 });
  }

  const results = [];
  for (const chunk of chunks) {
    const res = await sendSingleMessage(psid, chunk, options);
    results.push(res);
  }
  return results;
}

/**
 * Wysyła akcję nadawcy w Messengerze (np. 'mark_seen', 'typing_on', 'typing_off').
 * @param {string} psid
 * @param {'mark_seen'|'typing_on'|'typing_off'} action
 * @param {object} [options]
 */
async function sendSenderAction(psid, action, options = {}) {
  const token = options.pageAccessToken || process.env.PAGE_ACCESS_TOKEN;
  if (!token || !psid) return null;

  const version = options.graphVersion || DEFAULT_GRAPH_API_VERSION;
  const endpoint = `https://graph.facebook.com/${version}/me/messages`;
  const fetchFn = options.fetchImpl || fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { id: String(psid) },
        sender_action: action,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json().catch(() => ({}));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  MessengerApiError,
  MAX_MESSAGE_LENGTH,
  splitMessageForMessenger,
  sendSingleMessage,
  sendTextMessage,
  sendSenderAction,
};
