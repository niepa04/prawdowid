// evidenceMatcher.js - Dopasowanie pobranych dokumentów do konkretnego twierdzenia bez fikcyjnych cytatów
const { extractKeywords } = require('./queryGenerator');
const { containsPromptInjection } = require('./sourceFetcher');

const NEGATION_IN_CLAIM_REGEX = /\b(nie\s+(ma|było|była|były|wprowadzono|wydano|potwierdził\w*|stwierdzono|doszło|występuje|obowiązuje|przekracza)|brak\s+(ostrzeżeń|zagrożenia|utrudnień|skażenia|dowodów))\b/i;

const CONTRADICTION_SIGNALS_REGEX =
  /\b(odwołano|odwołuje|zostało\s+odwołane|dementuje|dementujemy|zdementował\w*|nie\s+potwierdz\w*|nieprawdziw\w*|fałszyw\w*\s+(informacj|komunikat|alert|alarm|wiadomoś)|brak\s+(ostrzeżeń|zagrożeń|zagrożenia|utrudnień|przekroczeń|skażenia)|nie\s+wprowadzono|nie\s+wydano|nie\s+stwierdzono|nie\s+obowiązuje|nie\s+przekracza|w\s+normie|poziom\s+normalny|bez\s+utrudnień|ruch\s+przywrócono|zakończono\s+utrudnienia)\b/i;

const CURRENT_SITUATION_REGEX =
  /\b(obecnie|aktualnie|teraz|dziś|dzisiaj|występuje|obowiązuje|trwa|wprowadzono|wydało|wydano|ostrzega|utrudnienie|ostrzeżenie|stężenie|poziom)\b/i;

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemApprox(word) {
  const w = word.toLowerCase();
  // Krótki rdzeń (min 4 znaki dla dłuższych słów) do lepszego dopasowania polskiej fleksji
  if (w.length <= 4) return w;
  return w.slice(0, Math.max(4, Math.floor(w.length * 0.72)));
}

function splitIntoSentences(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const rawParts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);
  return rawParts;
}

function computeTokenMatches(keywords, targetText) {
  const normTarget = normalizeForMatch(targetText);
  const targetWords = normTarget.split(/\s+/).filter(Boolean);
  const matched = [];

  for (const kw of keywords) {
    const lowerKw = kw.toLowerCase();
    const stem = stemApprox(lowerKw);
    const exactMatch =
      normTarget.includes(` ${lowerKw} `) ||
      normTarget.startsWith(`${lowerKw} `) ||
      normTarget.endsWith(` ${lowerKw}`) ||
      normTarget === lowerKw;
    const stemMatch =
      exactMatch ||
      (stem.length >= 4 && targetWords.some((w) => w.startsWith(stem)));

    if (stemMatch) {
      matched.push(kw);
    }
  }

  return matched;
}

/**
 * Sprawdza aktualność dokumentu względem aktualnej daty (lub nowOverride w testach).
 */
function evaluateFreshness(doc, claimText, config, nowMs) {
  const limitations = [];
  let isStale = false;
  const isCurrentClaim = CURRENT_SITUATION_REGEX.test(claimText) && !/\b(19\d\d|20[01]\d|202[0-4])\b/.test(claimText);

  if (doc.valid_to) {
    const validToMs = Date.parse(doc.valid_to);
    if (!Number.isNaN(validToMs) && validToMs < nowMs) {
      isStale = true;
      limitations.push(`Komunikat jest nieaktualny – okres obowiązywania wygasł (${doc.valid_to}).`);
    }
  }

  if (doc.observed_at && doc.measurement_data) {
    const obsMs = Date.parse(doc.observed_at);
    const maxAgeMs = (config.staleMeasurementAgeHours || 24) * 3600 * 1000;
    if (!Number.isNaN(obsMs) && nowMs - obsMs > maxAgeMs) {
      isStale = true;
      limitations.push(`Dane pomiarowe są nieaktualne (czas pomiaru: ${doc.observed_at}).`);
    }
  }

  if (doc.published_at && isCurrentClaim && !doc.valid_to) {
    const pubMs = Date.parse(doc.published_at);
    const maxWarnAgeMs = (config.staleWarningAgeDays || 14) * 24 * 3600 * 1000;
    if (!Number.isNaN(pubMs) && nowMs - pubMs > maxWarnAgeMs) {
      isStale = true;
      limitations.push(`Komunikat może być nieaktualny – data publikacji (${doc.published_at}) jest starsza niż ${config.staleWarningAgeDays || 14} dni.`);
    }
  }

  if (!doc.published_at && !doc.observed_at) {
    limitations.push('Brak daty publikacji i czasu pomiaru – nie można potwierdzić aktualności materiału.');
  }

  return { isStale, limitations };
}

/**
 * Dopasowuje pojedynczy pobrany dokument do pojedynczego twierdzenia z Modelu 2.
 * Zwraca obiekt dowodu lub null, jeśli dokument nie ma związku z twierdzeniem.
 */
function matchDocumentToClaim(doc, claim, allClaims, config, options = {}) {
  if (!doc || typeof doc.text !== 'string' || doc.text.trim().length < 15) {
    return null;
  }

  const nowMs = options.nowMs || Date.now();
  const claimText = claim.claim || '';
  const claimKeywords = extractKeywords(claimText, 8);
  const fullText = [doc.title || '', doc.text].filter(Boolean).join('\n');

  if (claimKeywords.length === 0) return null;

  // Sprawdzamy dopasowanie na poziomie całego dokumentu
  const docMatchedKeywords = computeTokenMatches(claimKeywords, fullText);
  const coverageRatio = docMatchedKeywords.length / claimKeywords.length;

  // Wymagamy realnego powiązania (co najmniej 2 słowa kluczowe lub >= 45% pokrycia dla krótkich twierdzeń)
  const minRequired = claimKeywords.length <= 2 ? 1 : 2;
  if (docMatchedKeywords.length < minRequired || coverageRatio < 0.3) {
    return null;
  }

  // Ekstrakcja WYŁĄCZNIE dosłownych fragmentów (relevant_excerpts) z doc.text
  const sentences = splitIntoSentences(doc.text);
  const scoredSentences = [];

  for (const sentence of sentences) {
    // Nigdy nie cytujemy fragmentu będącego wstrzyknięciem promptu jako dowodu merytorycznego
    if (containsPromptInjection(sentence)) continue;

    const sentMatches = computeTokenMatches(claimKeywords, sentence);
    if (sentMatches.length > 0) {
      // Weryfikacja dosłowności – fragment musi występować literalnie w doc.text
      const excerpt = sentence.length > 420 ? sentence.slice(0, 420) : sentence;
      if (doc.text.includes(excerpt)) {
        scoredSentences.push({
          excerpt,
          score: sentMatches.length / claimKeywords.length,
          hits: sentMatches.length,
        });
      }
    }
  }

  scoredSentences.sort((a, b) => b.hits - a.hits || b.score - a.score);
  const relevantExcerpts = [];
  const seenExcerpts = new Set();
  for (const s of scoredSentences) {
    if (seenExcerpts.has(s.excerpt)) continue;
    seenExcerpts.add(s.excerpt);
    relevantExcerpts.push(s.excerpt);
    if (relevantExcerpts.length >= 3) break;
  }

  // Jeśli zdania nie miały >15 znaków lub cała treść jest jednym krótkim komunikatem
  if (relevantExcerpts.length === 0 && !containsPromptInjection(doc.text)) {
    const rawSlice = doc.text.trim().slice(0, 320);
    if (rawSlice.length > 0 && doc.text.includes(rawSlice)) {
      relevantExcerpts.push(rawSlice);
    }
  }

  // Jeżeli wszystkie dopasowania były wyłącznie w treści prompt injection, odrzucamy
  if (relevantExcerpts.length === 0) {
    return null;
  }

  // Ocena aktualności
  const freshness = evaluateFreshness(doc, claimText, config, nowMs);
  const limitations = [...new Set([...(doc.limitations || []), ...freshness.limitations])];

  // Ocena relacji (supporting / contradicting / contextual)
  const claimIsNegative = NEGATION_IN_CLAIM_REGEX.test(claimText);
  const claimIsAboutFakeContent = /\b(fałszyw\w*|phishing\w*|oszustw\w*|dezinformacj\w*)\b/i.test(claimText);
  const excerptsJoined = relevantExcerpts.join(' ');
  const docHasContradictionSignal =
    CONTRADICTION_SIGNALS_REGEX.test(excerptsJoined) &&
    !(claimIsAboutFakeContent && /\bfałszyw\w*\s+(informacj|komunikat|alert|alarm|wiadomoś)/i.test(excerptsJoined) && !/\b(odwołano|odwołuje|dementuje|dementujemy|nie\s+potwierdz|nie\s+wydano|nie\s+wprowadzono)\b/i.test(excerptsJoined));

  let relationToClaim = 'contextual';
  let relevance = 'contextual';

  if (claim.type === 'opinion' || claim.type === 'non_verifiable') {
    relationToClaim = 'contextual';
    relevance = 'contextual';
    limitations.push(`Twierdzenie typu "${claim.type}" – materiał ma charakter wyłącznie kontekstowy.`);
  } else if (docHasContradictionSignal && !claimIsNegative) {
    relationToClaim = 'contradicting';
    relevance = coverageRatio >= 0.5 ? 'direct' : 'partial';
  } else if (!docHasContradictionSignal && claimIsNegative && coverageRatio >= 0.55) {
    relationToClaim = 'contradicting';
    relevance = 'direct';
  } else if (freshness.isStale) {
    // Nieaktualny komunikat nie jest traktowany jako bezpośrednie potwierdzenie bieżącej sytuacji
    relationToClaim = 'contextual';
    relevance = 'partial';
  } else if (coverageRatio >= 0.6) {
    relationToClaim = 'supporting';
    relevance = 'direct';
  } else if (coverageRatio >= 0.45 && docMatchedKeywords.length >= 2) {
    relationToClaim = 'supporting';
    relevance = 'partial';
  } else {
    relationToClaim = 'contextual';
    relevance = 'contextual';
  }

  return {
    source_id: doc.source_id,
    source_url: doc.source_url,
    title: doc.title ?? null,
    publisher: doc.publisher ?? null,
    published_at: doc.published_at ?? null,
    updated_at: doc.updated_at ?? null,
    event_date: doc.event_date ?? null,
    observed_at: doc.observed_at ?? null,
    retrieved_at: doc.retrieved_at,
    url: doc.url,
    source_type: doc.source_type || 'official_government',
    content_type: doc.content_type || 'text/html',
    relation_to_claim: relationToClaim,
    relevance,
    relevant_excerpts: relevantExcerpts,
    retrieval_status: doc.retrieval_status || 'ok',
    measurement_data: doc.measurement_data || null,
    independence_group: 'unknown',
    limitations,
    _matchScore: Number(coverageRatio.toFixed(3)),
    _isStale: freshness.isStale,
  };
}

module.exports = {
  matchDocumentToClaim,
  evaluateFreshness,
  splitIntoSentences,
};
