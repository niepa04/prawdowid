// evidenceMatcher.js - Dopasowanie pobranych dokumentów do konkretnego twierdzenia bez fikcyjnych cytatów
const { extractKeywords } = require('./queryGenerator');
const { buildClaimContextText } = require('./sourceRouter');
const { containsPromptInjection } = require('./sourceFetcher');

const NEGATION_IN_CLAIM_REGEX = /\b(nie\s+(ma|było|była|były|wprowadzono|wydano|potwierdził\w*|stwierdzono|doszło|występuje|obowiązuje|przekracza)|brak\s+(ostrzeżeń|zagrożenia|utrudnień|skażenia|dowodów))\b/i;

const CONTRADICTION_SIGNALS_REGEX =
  /\b(odwołano|odwołuje|zostało\s+odwołane|dementuje|dementujemy|zdementował\w*|nie\s+potwierdz\w*|nieprawdziw\w*|fałszyw\w*\s+(informacj|komunikat|alert|alarm|wiadomoś)|brak\s+(ostrzeżeń|zagrożeń|zagrożenia|utrudnień|przekroczeń|skażenia)|nie\s+wprowadzono|nie\s+wydano|nie\s+stwierdzono|nie\s+obowiązuje|nie\s+przekracza|w\s+normie|poziom\s+normalny|bez\s+utrudnień|ruch\s+przywrócono|zakończono\s+utrudnienia)\b/i;

const CURRENT_SITUATION_REGEX =
  /\b(obecnie|aktualnie|teraz|dziś|dzisiaj|występuje|obowiązuje|trwa|wprowadzono|wydało|wydano|ostrzega|utrudnienie|ostrzeżenie|stężenie|poziom)\b/i;

const GENERIC_INSTITUTION_WORDS = new Set([
  'imgw', 'gios', 'gioś', 'rcb', 'rso', 'gis', 'paa', 'cert', 'nask', 'gddkia', 'ulc', 'utk',
  'kgsok', 'sar', 'msz', 'mswia', 'mon', 'psp', 'kprm', 'policja', 'polska', 'polski', 'polsce',
  'ministerstwo', 'ministerstwa', 'spraw', 'zagranicznych', 'wewnętrznych', 'obrony', 'narodowej',
  'infrastruktury', 'administracji', 'urząd', 'urzędu', 'komenda', 'główna', 'państwowa', 'agencja',
  'inspektorat', 'sanitarny', 'centrum', 'bezpieczeństwa', 'rządowe', 'system', 'odyseusz',
]);

/**
 * Wyodrębnia twarde encje rozróżniające z twierdzenia (numery dróg, liczby, nazwy własne miejsc/osób),
 * aby komunikat o drodze A4 lub 1583K nie potwierdzał twierdzenia o drodze 66.
 */
function extractSpecificAnchors(claimText) {
  const anchors = [];
  const raw = String(claimText || '').trim();
  if (!raw) return anchors;

  // 1. Kody dróg, autostrad i pyłów (np. "A4", "A1", "S7", "DK66", "DW123", "PM10", "PM2.5")
  for (const m of raw.matchAll(/\b([AS]\d{1,2}|DK\s*\d{1,3}|DW\s*\d{1,3}|PM\s*\d+(?:[.,]\d+)?)\b/gi)) {
    const token = m[1].replace(/\s+/g, '').toLowerCase();
    if (!anchors.includes(token)) anchors.push(token);
  }

  // 2. Numery dróg zapisane słownie, np. "na drodze 66", "droga nr 66", "trasa 66"
  for (const m of raw.matchAll(/\b(?:drog[aąęi]|drodze|autostrad\w*|tras\w*)(?:\s+(?:krajow\w*|wojewódzk\w*|nr|numer))?\s+(\d{1,3})\b/gi)) {
    const num = m[1].toLowerCase();
    if (!anchors.includes(num)) anchors.push(num);
  }

  // 3. Nazwy własne (wielka litera wewnątrz zdania, np. "Warszawie", "Nawrocki", "Zagórz", "Krakowie")
  const words = raw.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  words.forEach((word, index) => {
    if (index === 0) return; // Pomijamy pierwsze słowo zdania
    if (word.length < 3) return;
    const isCapitalized = /^\p{Lu}\p{Ll}+/u.test(word);
    if (!isCapitalized) return;
    const lower = word.toLowerCase();
    if (GENERIC_INSTITUTION_WORDS.has(lower)) return;
    if (!anchors.includes(lower)) anchors.push(lower);
  });

  return anchors;
}

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
  // Zabezpieczamy popularne polskie skróty przed fałszywym cięciem zdania na kropce
  const PLACEHOLDER = '\u0000';
  const protectedText = text.replace(
    /\b(godz|ok|np|tzw|itp|itd|ul|al|pl|woj|pow|gm|nr|st|ost|cz|dr|prof|inż|mgr|bryg|gen|płk|mjr|kpt|por|sierż|św|tys|mln|mld|proc|pkt|ust|art|poz|dz|r|m)\.\s+/gi,
    (_, abbr) => `${abbr}.${PLACEHOLDER}`
  );

  return protectedText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replaceAll(PLACEHOLDER, ' ').trim())
    .filter((s) => s.length >= 15);
}

function extractCanonicalDates(text) {
  const results = [];
  const raw = String(text || '');
  // Format D.M.YYYY lub DD.MM.YYYY
  for (const m of raw.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      const canon = `${d}.${mo}.${y}`;
      if (!results.includes(canon)) results.push(canon);
    }
  }
  // Format YYYY-MM-DD
  for (const m of raw.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      const canon = `${d}.${mo}.${y}`;
      if (!results.includes(canon)) results.push(canon);
    }
  }
  return results;
}

function extractCanonicalTimes(text) {
  const results = [];
  const raw = String(text || '');
  for (const m of raw.matchAll(/(?:godz\.?\s*|\b)([01]?\d|2[0-3]):([0-5]\d)\b/gi)) {
    const hh = String(Number(m[1])).padStart(2, '0');
    const mm = m[2];
    const canon = `${hh}:${mm}`;
    if (!results.includes(canon)) results.push(canon);
  }
  return results;
}

function extractDegree(text) {
  const raw = String(text || '').toLowerCase();
  if (/\b(pierwszego|1|i)\s+stopnia\b|\/1\b/.test(raw)) return 1;
  if (/\b(drugiego|2|ii)\s+stopnia\b|\/2\b/.test(raw)) return 2;
  if (/\b(trzeciego|3|iii)\s+stopnia\b|\/3\b/.test(raw)) return 3;
  return null;
}

/**
 * Wykrywa zmanipulowane szczegóły (daty, godziny, stopnie, liczby przy jednostkach)
 * w częściowo prawdziwych twierdzeniach (np. "od 22.7.2026 do 22.11.2026" zamiast "22.11.2026").
 */
function detectFactualDiscrepancies(claimText, docText) {
  const discrepancies = [];

  const claimDates = extractCanonicalDates(claimText);
  const docDates = extractCanonicalDates(docText);
  if (claimDates.length > 0 && docDates.length > 0) {
    const missingDates = claimDates.filter((d) => !docDates.includes(d));
    if (missingDates.length > 0) {
      discrepancies.push(
        `Niezgodność daty: w twierdzeniu podano ${missingDates.join(', ')}, natomiast w oficjalnym źródle widnieje ${docDates.join(', ')}.`
      );
    }
  }

  const claimTimes = extractCanonicalTimes(claimText);
  const docTimes = extractCanonicalTimes(docText);
  if (claimTimes.length > 0 && docTimes.length > 0) {
    const missingTimes = claimTimes.filter((t) => !docTimes.includes(t));
    if (missingTimes.length > 0) {
      discrepancies.push(
        `Niezgodność godziny: w twierdzeniu podano ${missingTimes.join(', ')}, natomiast w oficjalnym źródle widnieje ${docTimes.join(', ')}.`
      );
    }
  }

  const claimDeg = extractDegree(claimText);
  const docDeg = extractDegree(docText);
  if (claimDeg !== null && docDeg !== null && claimDeg !== docDeg) {
    discrepancies.push(
      `Niezgodność stopnia zagrożenia: w twierdzeniu podano stopień ${claimDeg}, a w oficjalnym źródle stopień ${docDeg}.`
    );
  }

  // Liczba + jednostka/rzeczownik (np. "w 7 powiatach" vs "w 12 powiatach")
  const quantRegex = /\b(\d+)\s+(powiat\w*|osób|osoby|dron\w*|ofiar\w*|rannych|stacj\w*)\b/gi;
  const claimQuants = [...String(claimText || '').matchAll(quantRegex)];
  const docQuants = [...String(docText || '').matchAll(quantRegex)];
  for (const cq of claimQuants) {
    const cNum = cq[1];
    const cUnitStem = cq[2].toLowerCase().slice(0, 5);
    const matchingUnitInDoc = docQuants.filter((dq) => dq[2].toLowerCase().startsWith(cUnitStem));
    if (matchingUnitInDoc.length > 0 && !matchingUnitInDoc.some((dq) => dq[1] === cNum)) {
      discrepancies.push(
        `Niezgodność liczby (${cq[2]}): w twierdzeniu podano ${cNum}, a w oficjalnym źródle ${matchingUnitInDoc.map((d) => d[1]).join('/')}.`
      );
    }
  }

  return discrepancies;
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

  // Aktywne ostrzeżenia dla podróżujących pobierane na żywo z API Odyseusza obowiązują do odwołania (nie wygasają po 14 dniach)
  const isOdyseuszLiveProfile = doc.source_id === 'SRC001' || doc.source_id === 'SRC039';
  if (doc.published_at && isCurrentClaim && !doc.valid_to && !isOdyseuszLiveProfile) {
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
  const hasParents = Array.isArray(claim.related_to) && claim.related_to.length > 0;
  const effectiveClaimText = hasParents ? buildClaimContextText(claim, allClaims) : claimText;
  const claimKeywords = extractKeywords(effectiveClaimText, 9);
  const fullText = [doc.title || '', doc.publisher || '', doc.text].filter(Boolean).join('\n');

  if (claimKeywords.length === 0) return null;

  // Sprawdzamy dopasowanie na poziomie całego dokumentu
  const docMatchedKeywords = computeTokenMatches(claimKeywords, fullText);
  const coverageRatio = docMatchedKeywords.length / claimKeywords.length;

  // Wymagamy realnego powiązania (co najmniej 2 słowa kluczowe lub >= 45% pokrycia dla krótkich twierdzeń)
  const minRequired = claimKeywords.length <= 2 ? 1 : 2;
  if (docMatchedKeywords.length < minRequired || coverageRatio < 0.3) {
    return null;
  }

  // Twarda weryfikacja specyficznych encji (numery dróg, nazwy własne miejsc/osób):
  // Jeśli twierdzenie wskazuje konkretną drogę/miejsce/osobę (np. "droga 66"),
  // odrzucamy komunikaty dotyczące innych dróg/miejsc, które pasują tylko na słowach "utrudnienia drogowe".
  const specificAnchors = extractSpecificAnchors(effectiveClaimText);
  if (specificAnchors.length > 0) {
    const matchedAnchors = computeTokenMatches(specificAnchors, fullText);
    if (matchedAnchors.length === 0) {
      return null;
    }
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

  // Ocena aktualności i wykrywanie zmanipulowanych dat/godzin/liczb
  const freshness = evaluateFreshness(doc, claimText, config, nowMs);
  const discrepancies = detectFactualDiscrepancies(effectiveClaimText, fullText);
  const limitations = [...new Set([...(doc.limitations || []), ...freshness.limitations, ...discrepancies])];

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
  } else if (discrepancies.length > 0) {
    // Wykryto zmanipulowaną datę, godzinę, stopień lub liczbę w częściowo prawdziwym komunikacie!
    relationToClaim = 'contradicting';
    relevance = 'direct';
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
    discrepancies,
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
  detectFactualDiscrepancies,
};
