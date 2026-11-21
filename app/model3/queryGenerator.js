// queryGenerator.js - Generowanie zróżnicowanych zapytań dopasowanych do twierdzenia i wybranych źródeł
const { buildClaimContextText } = require('./sourceRouter');

const POLISH_STOPWORDS = new Set([
  'oraz', 'albo', 'jako', 'jest', 'było', 'była', 'były', 'będzie', 'został', 'została', 'zostało',
  'zostały', 'przez', 'przed', 'który', 'która', 'które', 'których', 'tego', 'tej', 'tych', 'temu',
  'tylko', 'także', 'również', 'może', 'mogą', 'bardzo', 'miał', 'miała', 'miało', 'mieli', 'miejsce',
  'zdarzenie', 'informacja', 'informację', 'dotyczył', 'dotyczyła', 'dotyczy', 'wobec', 'między',
  'ponad', 'około', 'jednak', 'według', 'teren', 'terytorium', 'oraz', 'czym', 'sobie', 'siebie',
]);

function extractKeywords(text, limit = 7) {
  const cleaned = String(text || '')
    .replace(/[^\p{L}\p{N}\s.,-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/);
  const seen = new Set();
  const result = [];

  for (const rawWord of words) {
    const word = rawWord.replace(/^[.,-]+|[.,-]+$/g, '');
    const lower = word.toLowerCase();
    if (word.length < 2) continue;
    // Zachowujemy krótkie oznaczenia dróg/stężeń (A1, S7, PM10, RCB, MSZ, ULC, UTK, GIS, PAA, MON, PSP, SAR)
    const isShortEntity = /^([as]\d{1,2}|dk\d{1,2}|pm\d+|rcb|rso|msz|ulc|utk|gis|paa|mon|psp|sar|imgw|cert|nask)$/i.test(word);
    if (!isShortEntity && (word.length < 3 || POLISH_STOPWORDS.has(lower))) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(word);
    if (result.length >= limit) break;
  }

  return result;
}

function getInstitutionShortName(source) {
  const name = source.name || '';
  const match = name.match(/^(IMGW|GIOŚ|RCB|GIS|PAA|CERT Polska|GDDKiA|ULC|UTK|KGSOK|SAR|MSZ|MSWiA|MON|PSP|Policja|Wody Polskie|KPRM|Odyseusz)/i);
  if (match) return match[1];
  return name.split(/[–-]/)[0].trim();
}

/**
 * Generuje 3-5 zapytań dla twierdzenia na daną rundę wyszukiwania (1..3).
 */
function generateQueriesForClaim(claim, allClaims, selectedSources, options = {}) {
  const maxQueries = Math.max(1, options.maxQueries || 5);
  const round = options.round || 1;
  const contextText = buildClaimContextText(claim, allClaims);
  const coreKeywords = extractKeywords(claim.claim || '', 6);
  const contextKeywords = extractKeywords(contextText, 7);

  const queries = [];
  const seen = new Set();

  function addQuery(text, intent, targetHost = null) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const key = `${clean.toLowerCase()}|${targetHost || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    queries.push({
      query: clean,
      intent,
      round,
      target_host: targetHost,
      site_scoped_query: targetHost ? `site:${targetHost} ${clean}` : clean,
    });
  }

  const basePhrase = (coreKeywords.length >= 2 ? coreKeywords : contextKeywords).slice(0, 5).join(' ');
  const fullPhrase = contextKeywords.slice(0, 6).join(' ');

  if (round === 1) {
    // 1. Zapytanie rdzeniowe
    addQuery(basePhrase, 'direct');

    // 2. Zapytanie kontekstowe z uwzględnieniem related_to (np. lokalizacja/czas)
    if (fullPhrase && fullPhrase.toLowerCase() !== basePhrase.toLowerCase()) {
      addQuery(fullPhrase, 'contextual_combined');
    }

    // 3. Zapytania dopasowane do wybranych instytucji i ich zatwierdzonych domen
    const usedHosts = new Set();
    for (const source of selectedSources) {
      if (queries.length >= maxQueries) break;
      const inst = getInstitutionShortName(source);
      const alreadyHasInst = basePhrase.toLowerCase().includes(inst.toLowerCase());
      const q = alreadyHasInst ? basePhrase : `${inst} ${basePhrase}`;
      if (!usedHosts.has(source.hostname)) {
        usedHosts.add(source.hostname);
        addQuery(q, 'source_targeted', source.hostname);
      } else {
        addQuery(q, 'institution_targeted', source.hostname);
      }
    }
  } else if (round === 2) {
    // Runda 2: bezpośrednie wyszukiwanie wewnętrzne na zatwierdzonych hostach + sprawdzanie zaprzeczeń/odwołań
    const shortCore = coreKeywords.slice(0, 4).join(' ');
    addQuery(basePhrase || shortCore, 'site_search_direct', selectedSources[0]?.hostname || null);
    if (fullPhrase && fullPhrase.toLowerCase() !== (basePhrase || '').toLowerCase()) {
      addQuery(fullPhrase, 'site_search_contextual', selectedSources[0]?.hostname || null);
    }
    addQuery(`${shortCore} odwołanie`, 'contradiction_check', selectedSources[0]?.hostname || null);
    addQuery(`${shortCore} dementi`, 'contradiction_check', selectedSources[0]?.hostname || null);
  } else {
    // Runda 3: szersze zapytania archiwalne/kontekstowe
    const broader = contextKeywords.slice(0, 3).join(' ');
    for (const source of selectedSources.slice(0, 2)) {
      addQuery(`${broader} komunikat`, 'broad_contextual', source.hostname);
    }
  }

  return queries.slice(0, maxQueries);
}

module.exports = {
  extractKeywords,
  generateQueriesForClaim,
};
