// factCheckProvider.js - gotowe oceny fact-checkerów z Google Fact Check Tools API
//
// Lekko, żeby nie obciążać pipeline'u:
// - jedno zapytanie do API na twierdzenie (drugie tylko gdy pierwsze nic nie zwróci),
// - nie pobieramy ani nie analizujemy stron fact-checkerów, bierzemy gotową ocenę z API,
// - najwyżej FACTCHECK_MAX_DOWODOW dowodów na twierdzenie, wyniki zapamiętywane na 10 minut,
// - bez klucza GOOGLE_FACTCHECK_API_KEY moduł nic nie robi.
//
// Dokumentacja API: https://developers.google.com/fact-check/tools/api/reference/rest

const { matchDocumentToClaim } = require('../evidenceMatcher');


const API_URL = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';
const FACTCHECK_MAX_DOWODOW = 3;
const TIMEOUT_MS = 6000;

// Zaufani fact-checkerzy piszący po polsku (sygnatariusze IFCN). Tylko ich oceny są brane pod uwagę,
// i tylko te hosty przepuszcza końcowa zapora Modelu 3 (validators/evidenceValidator.js).
const ZAUFANI_FACT_CHECKERZY = new Set([
  'demagog.org.pl',
  'sprawdzam.afp.com',
  'konkret24.tvn24.pl',
  'fakenews.pl',
]);

// Ocena fact-checkera -> stosunek do sprawdzanego twierdzenia
function relacjaZOceny(ocena) {
  const o = String(ocena || '').toLowerCase();
  if (/manipul|kontekst|wprowadza|częściow|czesciow|wyrwan|przesadz|mylą|myla/.test(o)) {
    return { relacja: 'contradicting', rozbieznosc: true };
  }
  if (/fałsz|falsz|nieprawd|przerobion|fake|zmanipul|wygenerowan|ai\b|nie ma dowod/.test(o)) {
    return { relacja: 'contradicting', rozbieznosc: false };
  }
  if (/^prawda|^prawdziw|potwierdz/.test(o)) {
    return { relacja: 'supporting', rozbieznosc: false };
  }
  return { relacja: 'contextual', rozbieznosc: false };
}

function hostZaufany(url) {
  try {
    return ZAUFANI_FACT_CHECKERZY.has(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

// API Google wymaga dopasowania wszystkich słów zapytania, więc całe zdanie zwykle nic nie zwraca.
// Wybieramy najbardziej charakterystyczne słowa: skróty (ABW, PPK), nazwy własne, potem najdłuższe.
function charakterystyczneSlowa(tekst) {
  const slowa = String(tekst).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const punkty = (w, i) => {
    if (w.length >= 2 && w === w.toUpperCase() && /\p{L}/u.test(w)) return 100; // skrót
    if (i > 0 && /^\p{Lu}/u.test(w) && w.length >= 3) return 50 + w.length; // nazwa własna
    return w.length >= 5 ? w.length : 0;
  };
  return [...new Map(slowa.map((w, i) => [w.toLowerCase(), { w, p: punkty(w, i) }])).values()]
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .map((x) => x.w);
}

// Podobieństwo dwóch zdań po rdzeniach słów (współczynnik Dice'a, 0..1).
// Liczone w obie strony, więc długi cytat, który tylko zawiera nasze słowa, ma niski wynik.
function podobienstwo(a, b) {
  const rdzenie = (t) =>
    new Set(
      String(t)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3 && !SLOWA_POMIJANE.has(w))
        .map((w) => w.slice(0, Math.max(3, Math.floor(w.length * 0.7))))
    );
  const A = rdzenie(a);
  const B = rdzenie(b);
  if (!A.size || !B.size) return 0;
  let wspolne = 0;
  for (const r of A) if (B.has(r)) wspolne++;
  return (2 * wspolne) / (A.size + B.size);
}
const MIN_PODOBIENSTWO = 0.6;
const SLOWA_POMIJANE = new Set([
  'jest', 'są', 'był', 'była', 'było', 'byli', 'będzie', 'oraz', 'przez', 'który', 'która', 'które',
  'jako', 'tego', 'tylko', 'nie', 'się', 'dla', 'pod', 'nad', 'przy', 'jak', 'też', 'ten', 'tej', 'ich',
]);

const cache = new Map();

async function zapytajApi(query, apiKey) {
  const klucz = query.toLowerCase();
  const zapamietane = cache.get(klucz);
  if (zapamietane && Date.now() - zapamietane.czas < 10 * 60 * 1000) return zapamietane.claims;

  const url = `${API_URL}?query=${encodeURIComponent(query)}&languageCode=pl&pageSize=10&key=${encodeURIComponent(apiKey)}`;
  const odp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!odp.ok) throw new Error(`Fact Check API HTTP ${odp.status}`);
  const dane = await odp.json();
  const claims = Array.isArray(dane.claims) ? dane.claims : [];
  cache.set(klucz, { czas: Date.now(), claims });
  return claims;
}

/**
 * Zwraca dowody (w formacie evidenceMatcher) z ocen zaufanych fact-checkerów.
 * @returns {Promise<{ evidence: object[], warnings: string[] }>}
 */
async function zbierzOcenyFactCheckerow(claim, allClaims, config, nowMs) {
  const apiKey = config.factCheckApiKey;
  if (!apiKey) return { evidence: [], warnings: [] };

  let wyniki = [];
  try {
    const slowa = charakterystyczneSlowa(claim.claim);
    // 1) trzy najbardziej charakterystyczne słowa, 2) samo najbardziej charakterystyczne słowo.
    // Wyszukiwarka Google bywa kapryśna przy kilku słowach, a trafność i tak sprawdza filtr podobieństwa.
    const zapytania = [slowa.slice(0, 3), slowa.slice(0, 1)].filter((s) => s.length >= 1).map((s) => s.join(' '));
    for (const q of [...new Set(zapytania)]) {
      wyniki = await zapytajApi(q, apiKey);
      if (wyniki.length > 0) break;
    }
  } catch (err) {
    return { evidence: [], warnings: [`Baza fact-checkerów Google była niedostępna (${err.message}).`] };
  }

  const evidence = [];
  for (const c of wyniki) {
    // Ocena dotyczy innego twierdzenia, które tylko dzieli z naszym kilka słów
    const podobne = podobienstwo(claim.claim, c.text);
    if (podobne < MIN_PODOBIENSTWO) continue;
    for (const r of c.claimReview || []) {
      if (!r?.url || !hostZaufany(r.url)) continue;
      const wydawca = r.publisher?.name || r.publisher?.site || 'fact-checker';

      // Dokument zbudowany z oceny, dopasowany do twierdzenia tym samym matcherem co reszta dowodów.
      // Jeśli sprawdzone przez fact-checkera twierdzenie nie pasuje do naszego, matcher zwróci null.
      const doc = {
        source_id: 'FACTCHECK',
        source_url: `https://${r.publisher?.site || new URL(r.url).hostname}/`,
        title: r.title || c.text,
        publisher: wydawca,
        published_at: r.reviewDate || c.claimDate || null,
        retrieved_at: new Date(nowMs).toISOString(),
        url: r.url,
        source_type: 'fact_checking',
        content_type: 'application/json',
        text: `Twierdzenie: "${c.text}". ${c.claimant ? `Autor twierdzenia: ${c.claimant}. ` : ''}Ocena ${wydawca}: ${r.textualRating}. ${r.title || ''}`,
      };
      const dopasowanie = matchDocumentToClaim(doc, claim, allClaims, config, { nowMs });
      if (!dopasowanie) continue;

      const { relacja, rozbieznosc } = relacjaZOceny(r.textualRating);
      dopasowanie.relation_to_claim = relacja;
      dopasowanie.relevant_excerpts = [`${wydawca}: „${c.text}” – ocena: ${r.textualRating}`];
      dopasowanie.discrepancies = rozbieznosc ? [`${wydawca} ocenił: ${r.textualRating}`] : [];
      dopasowanie.limitations = [
        ...(dopasowanie.limitations || []),
        'Ocena niezależnego fact-checkera (nie źródło rządowe), pobrana z Google Fact Check Tools.',
      ];
      evidence.push(dopasowanie);
    }
  }

  evidence.sort((a, b) => (b._matchScore || 0) - (a._matchScore || 0));
  return { evidence: evidence.slice(0, FACTCHECK_MAX_DOWODOW), warnings: [] };
}

module.exports = { zbierzOcenyFactCheckerow, ZAUFANI_FACT_CHECKERZY, relacjaZOceny, charakterystyczneSlowa, podobienstwo };
