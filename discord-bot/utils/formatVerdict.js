const { EmbedBuilder } = require('discord.js');

// Limity Discord Embed z bezpiecznym zapasem
const MAX_FIELD_VALUE = 1024;
const MAX_FIELD_NAME = 256;
const MAX_DESCRIPTION = 4096;
const MAX_FIELDS_PER_EMBED = 25;
const MAX_EMBEDS_PER_MESSAGE = 10;
const SAFE_MESSAGE_CHAR_BUDGET = 5400; // Discord limit: 6000 znaków łącznie w jednej wiadomości

const VERDICT_STYLES = {
  Potwierdzone: {
    color: 0x2ecc71,
    emoji: '✅',
  },
  Fałszywe: {
    color: 0xe74c3c,
    emoji: '❌',
  },
  'Wprowadzające w błąd': {
    color: 0xe67e22,
    emoji: '⚠️',
  },
  'Brak wystarczających dowodów': {
    color: 0xf1c40f,
    emoji: '❓',
  },
  'Nie podlega weryfikacji': {
    color: 0x95a5a6,
    emoji: 'ℹ️',
  },
};

function getVerdictStyle(verdict) {
  if (verdict && VERDICT_STYLES[verdict]) {
    return VERDICT_STYLES[verdict];
  }
  return { color: 0x3498db, emoji: '🔎' };
}

/**
 * Normalizuje tekst do porównania (eliminacja duplikatów uzasadnień).
 * @param {string} text
 * @returns {string}
 */
function normalizeForCompare(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Formatuje datę ISO (np. 2026-11-20T00:00:00.000Z) do czytelnej postaci YYYY-MM-DD.
 * @param {string} rawDate
 * @returns {string}
 */
function formatShortDate(rawDate) {
  if (!rawDate) return '';
  const str = String(rawDate).trim();
  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoMatch ? isoMatch[1] : str;
}

/**
 * Formatuje tekst jako cytat Markdown (> ...), obsługując wieloliniowość.
 * @param {string} text
 * @returns {string}
 */
function asBlockquote(text) {
  return String(text || '')
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Dzieli długi tekst na fragmenty mieszczące się w limicie znaków bez ucinania treści.
 * Preferuje podział po nowej linii lub spacji.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string[]}
 */
function splitText(text, maxLen) {
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

/**
 * Formatuje pojedyncze źródło jako zwięzły, elegancki wiersz z klikalnym linkiem.
 * @param {object} src
 * @param {number} index
 * @returns {string|null}
 */
function formatSourceLine(src, index) {
  if (!src || typeof src !== 'object') return null;
  let title = (src.title || src.publisher || src.source_id || 'Źródło')
    .replace(/[\[\]\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length > 90) {
    title = `${title.slice(0, 87)}...`;
  }

  const metaParts = [];
  if (src.publisher && src.publisher !== title) metaParts.push(`*${src.publisher}*`);
  const shortDate = formatShortDate(src.published_at);
  if (shortDate) metaParts.push(shortDate);
  const meta = metaParts.length > 0 ? ` — ${metaParts.join(', ')}` : '';

  const prefix = typeof index === 'number' ? `**${index + 1}.** ` : '• ';
  if (src.url && /^https?:\/\//i.test(src.url)) {
    return `${prefix}[${title}](${src.url})${meta}`;
  }
  return `${prefix}${title}${meta}`;
}

/**
 * Zbiera unikalne źródła z demagog.glowne_zrodla oraz demagog.twierdzenia[*].uzyte_zrodla.
 * @param {object} demagog
 * @returns {object[]}
 */
function collectUniqueSources(demagog) {
  const byKey = new Map();
  const add = (src) => {
    if (!src || typeof src !== 'object') return;
    const key = src.url || `${src.source_id || ''}:${src.title || ''}`;
    if (!key || byKey.has(key)) return;
    byKey.set(key, src);
  };

  if (Array.isArray(demagog?.glowne_zrodla)) {
    demagog.glowne_zrodla.forEach(add);
  }
  if (Array.isArray(demagog?.twierdzenia)) {
    for (const t of demagog.twierdzenia) {
      if (Array.isArray(t?.uzyte_zrodla)) {
        t.uzyte_zrodla.forEach(add);
      }
    }
  }
  return [...byKey.values()];
}

/**
 * Zarządza tworzeniem embedów i dzieleniem ich na kolejne wiadomości Discorda,
 * gdy treść przekracza limity znaków lub pól.
 */
class MessageBatchBuilder {
  constructor(baseColor, titlePrefix) {
    this.baseColor = baseColor;
    this.titlePrefix = titlePrefix;
    this.messages = [];
    this.currentEmbeds = [];
    this.currentMessageChars = 0;
    this.activeEmbed = null;
    this.activeEmbedChars = 0;
    this.activeFieldCount = 0;
  }

  startNewEmbed(title, description = null, { author = null } = {}) {
    const cleanTitle = String(title || this.titlePrefix).slice(0, 256);
    const cleanDesc = description ? String(description).slice(0, MAX_DESCRIPTION) : null;
    const authorChars = author?.name ? author.name.length : 0;
    const baseChars = cleanTitle.length + (cleanDesc ? cleanDesc.length : 0) + authorChars;

    if (
      this.activeEmbed &&
      (this.currentEmbeds.length >= MAX_EMBEDS_PER_MESSAGE ||
        this.currentMessageChars + baseChars > SAFE_MESSAGE_CHAR_BUDGET)
    ) {
      this.flushMessage();
    }

    const embed = new EmbedBuilder().setColor(this.baseColor).setTitle(cleanTitle);
    if (author) embed.setAuthor(author);
    if (cleanDesc) embed.setDescription(cleanDesc);

    this.activeEmbed = embed;
    this.activeEmbedChars = baseChars;
    this.activeFieldCount = 0;
    this.currentEmbeds.push(embed);
    this.currentMessageChars += baseChars;
  }

  addField(name, value, inline = false) {
    const cleanName = String(name || 'Informacja').slice(0, MAX_FIELD_NAME);
    const chunks = splitText(value, MAX_FIELD_VALUE);
    if (chunks.length === 0) return;

    chunks.forEach((chunk, idx) => {
      const fieldName = idx === 0 ? cleanName : `${cleanName} (cd.)`.slice(0, MAX_FIELD_NAME);
      const addedChars = fieldName.length + chunk.length;

      const needNewEmbed =
        !this.activeEmbed ||
        this.activeFieldCount >= MAX_FIELDS_PER_EMBED ||
        this.activeEmbedChars + addedChars > SAFE_MESSAGE_CHAR_BUDGET ||
        this.currentMessageChars + addedChars > SAFE_MESSAGE_CHAR_BUDGET;

      if (needNewEmbed) {
        this.startNewEmbed(`${this.titlePrefix} (ciąg dalszy)`);
      }

      this.activeEmbed.addFields({
        name: fieldName,
        value: chunk,
        inline: chunks.length === 1 ? inline : false,
      });
      this.activeEmbedChars += addedChars;
      this.currentMessageChars += addedChars;
      this.activeFieldCount += 1;
    });
  }

  setFooterAndTimestampOnFirst(footerText) {
    const target =
      this.messages.length > 0 && this.messages[0].embeds.length > 0
        ? this.messages[0].embeds[0]
        : this.currentEmbeds[0];
    if (!target) return;
    if (footerText) {
      target.setFooter({ text: footerText.slice(0, 2048) });
    }
    target.setTimestamp();
  }

  flushMessage() {
    if (this.currentEmbeds.length > 0) {
      this.messages.push({ embeds: this.currentEmbeds });
      this.currentEmbeds = [];
      this.currentMessageChars = 0;
      this.activeEmbed = null;
      this.activeEmbedChars = 0;
      this.activeFieldCount = 0;
    }
  }

  build() {
    this.flushMessage();
    return this.messages;
  }
}

/**
 * Buduje jedną lub więcej profesjonalnych wiadomości Discord Embed na podstawie
 * odpowiedzi z POST /api/weryfikuj, bez powtarzania uzasadnień i źródeł.
 *
 * @param {object} wynik - Surowa odpowiedź JSON z /api/weryfikuj
 * @param {string|object} inputInfo - Oryginalne dane wejściowe użytkownika
 * @returns {Array<{ embeds: EmbedBuilder[] }>}
 */
function buildVerificationMessages(wynik, inputInfo) {
  const demagog = wynik?.demagog || {};
  const metadane = wynik?.metadane || {};
  const werdyktOgolny = wynik?.werdykt_ogolny || demagog?.werdykt_ogolny || 'Brak werdyktu';
  const style = getVerdictStyle(werdyktOgolny);
  const twierdzenia = Array.isArray(demagog.twierdzenia) ? demagog.twierdzenia : [];

  const embedTitle = `${style.emoji} Werdykt: ${werdyktOgolny}`;
  const builder = new MessageBatchBuilder(style.color, embedTitle);

  // Opis główny — bez duplikowania treści między podsumowaniem a listą twierdzeń
  const descLines = [];

  if (werdyktOgolny === 'Brak wystarczających dowodów') {
    descLines.push(
      '*System nie odnalazł wystarczających dowodów w sprawdzonych źródłach, aby jednoznacznie potwierdzić lub obalić weryfikowane twierdzenia.*'
    );
  }

  const glownaOdpowiedz = String(demagog.glowna_odpowiedz || '').trim();
  const singleClaim = twierdzenia.length === 1 ? twierdzenia[0] : null;
  const shownSummaryJustification =
    twierdzenia.length <= 1 && Boolean(glownaOdpowiedz);

  if (shownSummaryJustification) {
    descLines.push(`**Uzasadnienie**\n${glownaOdpowiedz}`);
  } else if (twierdzenia.length > 1 && demagog.statystyki_werdyktow) {
    const statsParts = Object.entries(demagog.statystyki_werdyktow)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${getVerdictStyle(label).emoji} ${label}: **${count}**`);
    if (statsParts.length > 0) {
      descLines.push(`**Rozkład werdyktów (${twierdzenia.length} twierdzeń)**\n${statsParts.join('  •  ')}`);
    }
  }

  const fullDescription = descLines.join('\n\n') || `Przeanalizowano materiał w systemie KOMA.`;
  const descChunks = splitText(fullDescription, MAX_DESCRIPTION);

  builder.startNewEmbed(embedTitle, descChunks[0], {
    author: { name: 'KOMA • PRAWDOWID | Automatyczna weryfikacja informacji' },
  });
  for (let i = 1; i < descChunks.length; i += 1) {
    builder.addField('Uzasadnienie (cd.)', descChunks[i]);
  }

  // Zwięzłe pola metadanych (inline)
  if (demagog.kategoria_glowna) {
    builder.addField('📂 Kategoria', demagog.kategoria_glowna, true);
  }
  if (singleClaim?.sila_dowodow) {
    builder.addField('📊 Siła dowodów', singleClaim.sila_dowodow, true);
  }
  if (singleClaim?.pewnosc !== undefined && singleClaim?.pewnosc !== null) {
    builder.addField('🎯 Pewność', String(singleClaim.pewnosc), true);
  }

  // Przesłany materiał wejściowy
  const inputObj =
    typeof inputInfo === 'string'
      ? { tekst: inputInfo, linki: [], zdjecieNazwa: null }
      : inputInfo || {};

  if (inputObj.tekst) {
    const preview = inputObj.tekst.length > 350 ? `${inputObj.tekst.slice(0, 347)}...` : inputObj.tekst;
    builder.addField('📝 Weryfikowany tekst', asBlockquote(preview));
  }
  if (Array.isArray(inputObj.linki) && inputObj.linki.length > 0) {
    builder.addField('🔗 Przesłane linki', inputObj.linki.map((l) => `• ${l}`).join('\n'));
  }
  if (inputObj.zdjecieNazwa) {
    builder.addField('🖼️ Przesłane zdjęcie (OCR)', `\`${inputObj.zdjecieNazwa}\``, true);
  }

  // Analizowane twierdzenia — zero powtarzania uzasadnienia
  if (twierdzenia.length === 1) {
    const t = twierdzenia[0];
    const claimLines = [];
    if (t.claim) claimLines.push(asBlockquote(t.claim));

    // Pokaż uzasadnienie twierdzenia TYLKO jeśli nie zostało już wyświetlone w opisie głównym
    const normSummary = normalizeForCompare(glownaOdpowiedz);
    const normClaimReason = normalizeForCompare(t.uzasadnienie);
    if (t.uzasadnienie && (!shownSummaryJustification || normClaimReason !== normSummary)) {
      claimLines.push(`**Uzasadnienie:** ${t.uzasadnienie}`);
    }
    if (Array.isArray(t.ograniczenia) && t.ograniczenia.length > 0) {
      claimLines.push(`*Uwagi: ${t.ograniczenia.join('; ')}*`);
    }

    if (claimLines.length > 0) {
      builder.addField('🔎 Analizowane twierdzenie', claimLines.join('\n'));
    }
  } else if (twierdzenia.length > 1) {
    twierdzenia.forEach((t, idx) => {
      const cStyle = getVerdictStyle(t.werdykt);
      const verdictLabel = t.werdykt ? `${cStyle.emoji} ${t.werdykt}` : 'Brak werdyktu';
      const fieldName = `Twierdzenie ${idx + 1} • ${verdictLabel}`.slice(0, MAX_FIELD_NAME);

      const lines = [];
      if (t.claim) lines.push(asBlockquote(t.claim));

      const metaBits = [];
      if (t.sila_dowodow) metaBits.push(`Siła dowodów: **${t.sila_dowodow}**`);
      if (t.pewnosc !== undefined && t.pewnosc !== null) metaBits.push(`Pewność: **${t.pewnosc}**`);
      if (metaBits.length > 0) lines.push(metaBits.join(' • '));

      if (t.uzasadnienie) lines.push(t.uzasadnienie);
      if (Array.isArray(t.ograniczenia) && t.ograniczenia.length > 0) {
        lines.push(`*Uwagi: ${t.ograniczenia.join('; ')}*`);
      }

      builder.addField(fieldName, lines.join('\n') || 'Brak szczegółów z backendu.');
    });
  } else if (Array.isArray(wynik?.model2?.claims) && wynik.model2.claims.length > 0) {
    const m2List = wynik.model2.claims
      .map((c, idx) => `${idx + 1}. ${c.claim || c.text || JSON.stringify(c)}`)
      .join('\n');
    builder.addField('🔎 Wyodrębnione twierdzenia', m2List);
  } else {
    builder.addField(
      '🔎 Analizowane twierdzenia',
      'Backend nie wyodrębnił żadnych twierdzeń podlegających weryfikacji w przesłanym materiale.'
    );
  }

  // Zbiorcze źródła z klikalnymi linkami (wyświetlane raz, bez duplikacji)
  const uniqueSources = collectUniqueSources(demagog);
  if (uniqueSources.length > 0) {
    const sourcesText = uniqueSources.map((s, idx) => formatSourceLine(s, idx)).filter(Boolean).join('\n');
    if (sourcesText) {
      builder.addField(`📚 Źródła wykorzystane do weryfikacji (${uniqueSources.length})`, sourcesText);
    }
  }

  // Ostrzeżenia z pipeline'u
  if (Array.isArray(metadane.ostrzezenia) && metadane.ostrzezenia.length > 0) {
    builder.addField('⚠️ Ostrzeżenia systemu', metadane.ostrzezenia.map((o) => `• ${o}`).join('\n'));
  }

  // Stopka z metadanymi i znacznikiem czasu
  const footerParts = [];
  if (typeof metadane.liczba_twierdzen === 'number') {
    footerParts.push(`Twierdzeń: ${metadane.liczba_twierdzen}`);
  }
  if (typeof metadane.liczba_dowodow === 'number') {
    footerParts.push(`Dowodów: ${metadane.liczba_dowodow}`);
  }
  if (typeof metadane.czas_calkowity_ms === 'number') {
    footerParts.push(`Czas analizy: ${(metadane.czas_calkowity_ms / 1000).toFixed(1)} s`);
  }
  builder.setFooterAndTimestampOnFirst(footerParts.join(' • '));

  return builder.build();
}

module.exports = {
  buildVerificationMessages,
  getVerdictStyle,
  splitText,
};
