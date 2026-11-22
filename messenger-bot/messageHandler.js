// messageHandler.js - Obsługa zdarzeń Messengera z natychmiastowym potwierdzeniem, typing_on, OCR i KOMA
const { sendTextMessage, sendSenderAction } = require('./messengerApi');
const { formatKomaResultForMessenger, isGreetingOrHelp } = require('./messengerService');

const DEFAULT_KOMA_API_URL = 'http://localhost:3000';
const KOMA_TIMEOUT_MS = 600000; // 10 min (zgodne z koma.js)
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

function getKomaApiUrl() {
  const raw = (process.env.KOMA_API_URL || DEFAULT_KOMA_API_URL).trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('KOMA_API_URL musi używać protokołu http:// lub https://');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

function maskPsid(psid) {
  const s = String(psid || '');
  if (s.length <= 4) return '***';
  return `***${s.slice(-4)}`;
}

async function downloadMessengerImageAsDataUri(url, fetchImpl = fetch) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Nieprawidłowy adres załącznika.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Nieobsługiwany protokół załącznika.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(parsed.href, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Nie udało się pobrać zdjęcia (HTTP ${response.status}).`);
    }
    const rawMime = (response.headers?.get?.('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      throw new Error('Nieobsługiwany format zdjęcia (dozwolone: PNG, JPG, WEBP, GIF, BMP).');
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
      throw new Error('Zdjęcie jest puste lub większe niż 5 MB.');
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  } finally {
    clearTimeout(timer);
  }
}

async function forwardToKoma(payload, fetchImpl = fetch) {
  const baseUrl = getKomaApiUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KOMA_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${baseUrl}/api/weryfikuj`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.blad || `Błąd backendu KOMA (HTTP ${response.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Analiza w KOMA przekroczyła limit czasu oczekiwania.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function buildWelcomeReply() {
  return [
    'Hej! 👋 Jestem KOMA — Twój szybki detektor fake newsów.',
    '',
    'Wrzuć tu cokolwiek, co chcesz sprawdzić:',
    '📝 podejrzany tekst albo viralowy post',
    '🔗 link do artykułu lub rolki',
    '🖼️ screena z TikToka, Instagrama czy X',
    '',
    'Sprawdzę to w oficjalnych źródłach i u fact-checkerów, a potem dam Ci prostą odpowiedź bez lania wody!',
  ].join('\n');
}

async function handleIncomingEvent(event, deps = {}) {
  const sendFn = deps.sendFn || sendTextMessage;
  const actionFn = deps.actionFn || sendSenderAction;
  const fetchImpl = deps.fetchImpl || fetch;
  const pipelineFn = deps.pipelineFn || ((payload) => forwardToKoma(payload, fetchImpl));
  const downloadImageFn = deps.downloadImageFn || ((url) => downloadMessengerImageAsDataUri(url, fetchImpl));
  const logger = deps.logger || console;

  const { psid, text = '', attachments = [] } = event || {};
  if (!psid) return;

  logger.log(
    `[MESSENGER] Odebrano wiadomość od ${maskPsid(psid)} | tekst=${text ? text.length : 0} znaków | załączników=${attachments.length}`
  );

  // Szybka odpowiedź na przywitanie / pomoc bez uruchamiania pipeline'u AI
  if (text && attachments.length === 0 && isGreetingOrHelp(text)) {
    await actionFn(psid, 'mark_seen').catch(() => {});
    await sendFn(psid, buildWelcomeReply());
    return;
  }

  const imageAttachments = attachments.filter((a) => a.type === 'image' && a.url);
  const linkAttachments = attachments
    .filter((a) => a.type !== 'image' && a.url && /^https?:\/\//i.test(a.url))
    .map((a) => a.url);

  // Jeśli użytkownik wysłał np. naklejkę, audio albo plik bez tekstu/zdjęcia/linku
  if (!text && imageAttachments.length === 0 && linkAttachments.length === 0) {
    await sendFn(
      psid,
      'Widzimy załącznik, ale na razie umiemy sprawdzać tekst, linki i zdjęcia (screeny). Podeślij tekst, link albo zrzut ekranu!'
    );
    return;
  }

  // 1. Natychmiastowe oznaczenie przeczytania, wskaźnik pisania i potwierdzenie odbioru
  await actionFn(psid, 'mark_seen').catch(() => {});
  await actionFn(psid, 'typing_on').catch(() => {});

  const ackText =
    imageAttachments.length > 0
      ? '👀 Mamy Twojego screena! Już wrzucamy go do analizy i sprawdzamy źródła — daj nam chwilkę (zwykle do minuty), zaraz wracamy z werdyktem!'
      : '👀 Mamy Twoją wiadomość! Już sprawdzamy ją w oficjalnych źródłach i u fact-checkerów — daj nam chwilkę (zwykle do minuty), zaraz odpisujemy!';

  await sendFn(psid, ackText);
  await actionFn(psid, 'typing_on').catch(() => {});

  // Odświeżaj wskaźnik pisania co 15 s (Meta wygasza typing_on po ~20 s)
  const typingIntervalMs = deps.typingIntervalMs ?? 15000;
  const typingTimer =
    typingIntervalMs > 0
      ? setInterval(() => {
          actionFn(psid, 'typing_on').catch(() => {});
        }, typingIntervalMs)
      : null;

  try {
    const zdjecia = [];
    for (const img of imageAttachments.slice(0, 10)) {
      const dataUri = await downloadImageFn(img.url);
      zdjecia.push(dataUri);
    }

    const payload = {};
    if (text) payload.tekst = text;
    if (linkAttachments.length > 0) payload.linki = linkAttachments;
    if (zdjecia.length > 0) payload.zdjecia = zdjecia;

    const wynik = await pipelineFn(payload);
    const replyText = formatKomaResultForMessenger(wynik);
    await sendFn(psid, replyText);
  } catch (err) {
    logger.error(`[MESSENGER] Błąd przetwarzania wiadomości dla ${maskPsid(psid)}: ${err.message}`);
    try {
      await sendFn(
        psid,
        'Ups, coś poszło nie tak po naszej stronie i nie udało się teraz dokończyć sprawdzania 😕 Spróbuj wysłać to jeszcze raz za chwilę!'
      );
    } catch (sendErr) {
      logger.error(`[MESSENGER] Nie udało się wysłać komunikatu błędu do ${maskPsid(psid)}: ${sendErr.message}`);
    }
  } finally {
    if (typingTimer) clearInterval(typingTimer);
  }
}

module.exports = {
  maskPsid,
  forwardToKoma,
  downloadMessengerImageAsDataUri,
  handleIncomingEvent,
};
