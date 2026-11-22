// messengerService.js - Weryfikacja podpisu Meta, parsowanie zdarzeń i przyjazne formatowanie odpowiedzi KOMA
const crypto = require('node:crypto');

const VERDICT_LABELS = {
  Potwierdzone: '✅ PRAWDA (Potwierdzone)',
  Fałszywe: '❌ FAKE (Fałszywe)',
  'Wprowadzające w błąd': '⚠️ UWAGA: Wprowadza w błąd',
  'Brak wystarczających dowodów': '🤷 BRAK DOWODÓW (Nie da się tego teraz potwierdzić)',
  'Nie podlega weryfikacji': '💬 OPINIA / NIEWERYFIKOWALNE',
};

const VERDICT_EMOJI = {
  Potwierdzone: '✅',
  Fałszywe: '❌',
  'Wprowadzające w błąd': '⚠️',
  'Brak wystarczających dowodów': '🤷',
  'Nie podlega weryfikacji': '💬',
};

function verifyWebhookSignature(rawBody, signatureHeader, appSecret = process.env.META_APP_SECRET) {
  if (!appSecret || typeof appSecret !== 'string' || appSecret.trim() === '') {
    return false;
  }
  if (!rawBody || !signatureHeader || typeof signatureHeader !== 'string') {
    return false;
  }
  if (!signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const receivedHex = signatureHeader.slice('sha256='.length).trim();
  if (!/^[0-9a-f]{64}$/i.test(receivedHex)) {
    return false;
  }

  const expectedHex = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHex.toLowerCase(), 'utf8');
  const expectedBuf = Buffer.from(expectedHex.toLowerCase(), 'utf8');

  if (receivedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

function extractMessagingEvents(payload, pageId = process.env.PAGE_ID) {
  if (!payload || typeof payload !== 'object' || payload.object !== 'page') {
    return [];
  }
  if (!Array.isArray(payload.entry)) {
    return [];
  }

  const events = [];

  for (const entry of payload.entry) {
    if (!entry || !Array.isArray(entry.messaging)) continue;

    for (const item of entry.messaging) {
      if (!item || typeof item !== 'object') continue;

      const senderId = item.sender?.id ? String(item.sender.id) : null;
      if (!senderId) continue;

      if (item.message?.is_echo === true) continue;
      if (pageId && senderId === String(pageId)) continue;

      if (!item.message || typeof item.message !== 'object') continue;

      const text = typeof item.message.text === 'string' ? item.message.text.trim() : '';
      const rawAttachments = Array.isArray(item.message.attachments) ? item.message.attachments : [];
      const attachments = rawAttachments
        .filter((att) => att && typeof att === 'object')
        .map((att) => ({
          type: String(att.type || 'unknown'),
          url: typeof att.payload?.url === 'string' ? att.payload.url : null,
        }));

      if (!text && attachments.length === 0) continue;

      events.push({
        psid: senderId,
        text,
        attachments,
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : null,
      });
    }
  }

  return events;
}

/**
 * Sprawdza, czy wiadomość to krótkie przywitanie lub prośba o instrukcję (bez twierdzeń do weryfikacji).
 * @param {string} text
 * @returns {boolean}
 */
function isGreetingOrHelp(text) {
  const clean = String(text || '')
    .toLowerCase()
    .replace(/[!?.👋🙏✨]+/g, '')
    .trim();
  if (!clean) return false;
  const greetings = new Set([
    'hej',
    'hejka',
    'czesc',
    'cześć',
    'siema',
    'siemanko',
    'elo',
    'yo',
    'hi',
    'hello',
    'dzien dobry',
    'dzień dobry',
    'start',
    'pomoc',
    'help',
    'info',
    'co robisz',
    'jak to dziala',
    'jak to działa',
  ]);
  return greetings.has(clean);
}

function formatShortDate(rawDate) {
  if (!rawDate) return '';
  const match = String(rawDate).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function collectUniqueSources(demagog) {
  const byKey = new Map();
  const add = (src) => {
    if (!src || typeof src !== 'object') return;
    const key = src.url || `${src.source_id || ''}:${src.title || ''}`;
    if (!key || byKey.has(key)) return;
    byKey.set(key, src);
  };
  if (Array.isArray(demagog?.glowne_zrodla)) demagog.glowne_zrodla.forEach(add);
  if (Array.isArray(demagog?.twierdzenia)) {
    for (const t of demagog.twierdzenia) {
      if (Array.isArray(t?.uzyte_zrodla)) t.uzyte_zrodla.forEach(add);
    }
  }
  return [...byKey.values()];
}

/**
 * Formatuje wynik pipeline'u KOMA do przejrzystej, nowoczesnej wiadomości dla młodych na Messengerze
 * (bez powtarzania uzasadnień i bez surowych linków markdown).
 * @param {object} wynik
 * @returns {string}
 */
function formatKomaResultForMessenger(wynik) {
  if (!wynik || typeof wynik !== 'object') {
    return 'Hmm, KOMA nie zwróciła wyniku analizy. Spróbuj wysłać tę wiadomość jeszcze raz!';
  }

  const demagog = wynik.demagog || {};
  const metadane = wynik.metadane || {};
  const werdykt = wynik.werdykt_ogolny || demagog.werdykt_ogolny || 'Brak werdyktu';
  const verdictBanner = VERDICT_LABELS[werdykt] || `🔎 ${werdykt}`;
  const twierdzenia = Array.isArray(demagog.twierdzenia) ? demagog.twierdzenia : [];

  const lines = [verdictBanner];

  if (demagog.kategoria_glowna) {
    lines.push(`📂 Temat: ${demagog.kategoria_glowna}`);
  }

  if (twierdzenia.length === 1) {
    const t = twierdzenia[0];
    if (t.sila_dowodow && t.sila_dowodow !== 'brak') {
      lines.push(`📊 Pewność dowodów: ${t.sila_dowodow}`);
    }
    const reason = String(demagog.glowna_odpowiedz || t.uzasadnienie || '').trim();
    if (reason) {
      lines.push('');
      lines.push(`🧠 O co chodzi:\n${reason}`);
    }
  } else if (twierdzenia.length > 1) {
    lines.push('');
    lines.push(`🔎 Rozłożyliśmy to na ${twierdzenia.length} wątki:`);
    twierdzenia.forEach((t, idx) => {
      const emoji = VERDICT_EMOJI[t.werdykt] || '•';
      lines.push('');
      lines.push(`${idx + 1}. ${emoji} ${t.werdykt || 'Brak werdyktu'}`);
      if (t.claim) lines.push(`„${t.claim}”`);
      if (t.uzasadnienie) lines.push(t.uzasadnienie);
    });
  } else if (demagog.glowna_odpowiedz) {
    lines.push('');
    lines.push(`🧠 O co chodzi:\n${demagog.glowna_odpowiedz}`);
  } else {
    lines.push('');
    lines.push('Nie znaleźliśmy tu konkretnego twierdzenia faktograficznego do sprawdzenia.');
  }

  if (werdykt === 'Brak wystarczających dowodów') {
    lines.push('');
    lines.push('💡 Tip: Jeśli nie ma twardych dowodów w oficjalnych źródłach, lepiej podchodzić do takiego newsa z dystansem.');
  }

  const zrodla = collectUniqueSources(demagog);
  if (zrodla.length > 0) {
    lines.push('');
    lines.push('🔗 Skąd to wiemy:');
    zrodla.slice(0, 5).forEach((z, idx) => {
      let title = String(z.title || z.publisher || 'Źródło').replace(/\s+/g, ' ').trim();
      if (title.length > 80) title = `${title.slice(0, 77)}...`;
      const metaParts = [];
      if (z.publisher && z.publisher !== title) metaParts.push(z.publisher);
      const date = formatShortDate(z.published_at);
      if (date) metaParts.push(date);
      const meta = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : '';
      lines.push(`${idx + 1}. ${title}${meta}`);
      if (z.url) lines.push(`   ${z.url}`);
    });
  }

  if (typeof metadane.czas_calkowity_ms === 'number') {
    lines.push('');
    lines.push(`⚡ Sprawdzono w ${(metadane.czas_calkowity_ms / 1000).toFixed(1)} s`);
  }

  return lines.join('\n');
}

module.exports = {
  verifyWebhookSignature,
  extractMessagingEvents,
  isGreetingOrHelp,
  formatKomaResultForMessenger,
};
