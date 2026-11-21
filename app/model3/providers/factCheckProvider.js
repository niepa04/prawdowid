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

// Zapytania do bazy Google. Wyszukiwarka odpowiada najlepiej na sąsiednie słowa ze zdania
// ("urodzone cesarskim cięciem"), a słabo na słowa wyrwane z różnych miejsc. Kolejność:
// trójki i pary sąsiednich słów od najbardziej charakterystycznych, na końcu jedno najważniejsze słowo.
const MAX_ZAPYTAN = 6;
// Słowa tak pospolite w polskich fact-checkach, że zapytanie z nimi zwraca przypadkowe wyniki
const POSPOLITE_W_ZAPYTANIU = /^(polsk|polac|polak|polsce)/i;
function zapytaniaDoBazy(tekst) {
  const slowa = String(tekst)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !SLOWA_POMIJANE.has(w.toLowerCase()) && !POSPOLITE_W_ZAPYTANIU.test(w));
  // Wielka litera tylko na początku zdania nie oznacza nazwy własnej
  const pierwsze = String(tekst).trim().split(/[^\p{L}\p{N}]+/u)[0];
  const w = (x) => waga(x, x === pierwsze ? 0 : 1);
  const pojedyncze = [...new Set(slowa)].sort((a, b) => w(b) - w(a));
  const ngramy = [];
  for (const n of [3, 2]) {
    for (let i = 0; i + n <= slowa.length; i++) {
      const czesc = slowa.slice(i, i + n);
      ngramy.push({ q: czesc.join(' '), w: czesc.reduce((s, x) => s + w(x), 0) / n + n });
    }
  }
  ngramy.sort((a, b) => b.w - a.w);
  // Na końcu pojedyncze słowa: wyszukiwarka Google czasem znajduje twierdzenie tylko po jednym słowie
  const kolejnosc = [
    pojedyncze.slice(0, 3).join(' '),
    ...ngramy.filter((x) => x.q.split(' ').length === 3).slice(0, 1).map((x) => x.q),
    ...ngramy.filter((x) => x.q.split(' ').length === 2).slice(0, 1).map((x) => x.q),
    ...pojedyncze.slice(0, 3),
  ];
  return [...new Set(kolejnosc.filter(Boolean))].slice(0, MAX_ZAPYTAN);
}

// Waga słowa w zapytaniu: skróty (ABW, PPK), nazwy własne, potem dłuższe słowa
function waga(w, pozycja = 1) {
  if (w.length >= 2 && w === w.toUpperCase() && /\p{L}/u.test(w)) return 30;
  if (pozycja > 0 && /^\p{Lu}/u.test(w)) return 12 + w.length;
  return w.length;
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
        // rdzeń = 6 pierwszych liter: "szczepionki"/"szczepieniach" -> "szczep", "autyzm"/"autyzmu" -> "autyzm"
        .map((w) => w.slice(0, 6))
    );
  const A = rdzenie(a);
  const B = rdzenie(b);
  if (!A.size || !B.size) return 0;
  let wspolne = 0;
  for (const r of A) if (B.has(r)) wspolne++;
  return (2 * wspolne) / (A.size + B.size);
}
// Usuwa wstępy, które nie są treścią twierdzenia: dopiski Modelu 2 ("Istnieje twierdzenie, że",
// "Autor tekstu kwestionuje, czy"), powołania ("Udowodniono, że", "Badania pokazują, że")
// i formę pytania ("Czy ...?"). Oceniane jest samo sedno.
function oczyscMeta(tekst) {
  return String(tekst || '')
    .replace(/^\s*(istnieje\s+(twierdzenie|opinia|pogląd|przekonanie)|(ktoś|niektórzy|autor\w*(\s+tekstu)?|użytkownik\w*)\s+(twierdzi|twierdzą|uważa|uważają|sugeruje|sugerują|kwestionuje|pyta))\s*,?\s*(że|iż|czy)?\s+/i, '')
    .replace(/^\s*(udowodniono|potwierdzono|wykazano|ustalono|okazało się|zostało udowodnione|naukowcy (udowodnili|potwierdzili|wykazali)|badania (pokazują|wykazały|dowodzą)|mówi się|słyszałem|słyszałam|podobno)\s*,?\s*(że|iż)?\s+/i, '')
    .replace(/^\s*czy\s+/i, '')
    .replace(/\?+\s*$/, '')
    .trim();
}

// Czy zdanie jest zaprzeczone: nieparzysta liczba słów przeczących ("nie", "nigdy", "żaden"...).
// Proste, ale wystarcza do odróżnienia "X" od "nie X" w krótkich twierdzeniach.
const PRZECZENIA = /^(nie|nigdy|żaden|żadna|żadne|żadnego|żadnej|żadnych|wcale|bynajmniej|brak|nieprawda)$/i;
function przeczenie(tekst) {
  const slowa = String(tekst || '').toLowerCase().split(/[^\p{L}]+/u);
  const ile = slowa.filter((w) => PRZECZENIA.test(w)).length;
  return ile % 2 === 1;
}

const MIN_PODOBIENSTWO = 0.55;
const MIN_PODOBIENSTWO_ARTYKULU = 0.35;

// Fact-checkerzy, których artykuły Model 3 otwiera i czyta (muszą być w katalogu źródeł).
const HOSTY_PRZEGLADANE = new Set(['demagog.org.pl']);
function hostPrzegladany(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTY_PRZEGLADANE.has(u.hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}
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
  if (!apiKey) return { evidence: [], warnings: [], artykuly: [] };

  let wyniki = [];
  // Model 2 czasem przeformułowuje twierdzenie ("Istnieje twierdzenie, że..."), więc szukamy
  // i porównujemy także po oryginalnych słowach użytkownika (source_text).
  const warianty = [...new Set([oczyscMeta(claim.source_text), oczyscMeta(claim.claim)].filter((t) => typeof t === 'string' && t.trim()))];
  const podobienstwoDo = (tekst) => Math.max(...warianty.map((w) => podobienstwo(w, tekst)));

  try {
    // Kolejne zapytania aż do znalezienia pasującej oceny (najwyżej MAX_ZAPYTAN).
    // Wyniki ze wszystkich zapytań są łączone; trafność i tak sprawdza filtr podobieństwa.
    const widziane = new Set();
    for (const q of zapytaniaDoBazy(warianty[0])) {
      for (const c of await zapytajApi(q, apiKey)) {
        const klucz = `${c.text}|${c.claimReview?.[0]?.url}`;
        if (!widziane.has(klucz)) {
          widziane.add(klucz);
          wyniki.push(c);
        }
      }
      if (wyniki.some((c) => podobienstwoDo(c.text) >= MIN_PODOBIENSTWO)) break;
    }
  } catch (err) {
    return { evidence: [], warnings: [`Baza fact-checkerów Google była niedostępna (${err.message}).`], artykuly: [] };
  }

  const evidence = [];
  const artykuly = []; // { url, podobne } - artykuły z hostów przeglądanych przez Model 3 (Demagog)
  for (const c of wyniki) {
    const podobne = podobienstwoDo(c.text);

    // Artykuły na pokrewny temat warto przeczytać, nawet jeśli dotyczą nieco innego twierdzenia:
    // ich treść i tak przechodzi później przez zwykły matcher Modelu 3.
    if (podobne >= MIN_PODOBIENSTWO_ARTYKULU) {
      for (const r of c.claimReview || []) {
        if (r?.url && hostPrzegladany(r.url)) artykuly.push({ url: r.url, podobne });
      }
    }

    // Ocena dotyczy innego twierdzenia, które tylko dzieli z naszym kilka słów
    if (podobne < MIN_PODOBIENSTWO) continue;
    for (const r of c.claimReview || []) {
      if (!r?.url || !hostZaufany(r.url)) continue;
      const wydawca = r.publisher?.name || r.publisher?.site || 'fact-checker';

      // Dokument zbudowany z oceny, dopasowany do twierdzenia tym samym matcherem co reszta dowodów.
      // Jeśli sprawdzone przez fact-checkera twierdzenie nie pasuje do naszego, matcher zwróci null.
      const doc = {
        source_id: 'FACTCHECK',
        source_url: `https://${r.publisher?.site || new URL(r.url).hostname}/`,
        title: `Ocena ${wydawca}: ${r.title || c.text}`,
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

      // Trafność z podobieństwa twierdzeń (matcher dla "opinii" z zasady daje tylko kontekst)
      dopasowanie.relevance = podobne >= 0.75 ? 'direct' : 'partial';

      // Przeczenie: "szczepionki NIE powodują autyzmu" jest podobne słownie do "szczepionki powodują
      // autyzm", ale znaczy odwrotnie. Wtedy ocena fact-checkera dotyczy twierdzenia PRZECIWNEGO.
      const przeciwne = przeczenie(warianty[0]) !== przeczenie(c.text);
      const { relacja, rozbieznosc } = relacjaZOceny(r.textualRating);

      if (przeciwne) {
        // Fałsz twierdzenia przeciwnego = zgodność naszego; Prawda przeciwnego = zaprzeczenie naszego.
        // Ocen pośrednich (manipulacja, brak kontekstu) nie da się odwrócić - zostają kontekstem.
        const odwrocona = rozbieznosc ? 'contextual' : relacja === 'contradicting' ? 'supporting' : relacja === 'supporting' ? 'contradicting' : 'contextual';
        dopasowanie.relation_to_claim = odwrocona;
        dopasowanie.fact_check_rating_przeciwnego = r.textualRating;
        dopasowanie.relevant_excerpts = [
          `${wydawca} ocenił twierdzenie PRZECIWNE do sprawdzanego: „${c.text}” – ocena: ${r.textualRating}`,
        ];
        dopasowanie.discrepancies = [];
      } else {
        dopasowanie.relation_to_claim = relacja;
        dopasowanie.fact_check_rating = r.textualRating; // oryginalna ocena fact-checkera, czyta ją moduł Demagog
        dopasowanie.relevant_excerpts = [`${wydawca}: „${c.text}” – ocena: ${r.textualRating}`];
        dopasowanie.discrepancies = rozbieznosc ? [`${wydawca} ocenił: ${r.textualRating}`] : [];
      }
      dopasowanie.fact_check_claim = c.text;
      dopasowanie.limitations = [
        ...(dopasowanie.limitations || []),
        'Ocena niezależnego fact-checkera (nie źródło rządowe), pobrana z Google Fact Check Tools.',
      ];
      evidence.push(dopasowanie);
    }
  }

  evidence.sort((a, b) => (b._matchScore || 0) - (a._matchScore || 0));
  const unikalneArtykuly = [...new Map(artykuly.sort((a, b) => b.podobne - a.podobne).map((a) => [a.url, a])).values()];
  return {
    evidence: evidence.slice(0, FACTCHECK_MAX_DOWODOW),
    warnings: [],
    artykuly: unikalneArtykuly.map((a) => a.url),
  };
}

module.exports = {
  zbierzOcenyFactCheckerow,
  ZAUFANI_FACT_CHECKERZY,
  HOSTY_PRZEGLADANE,
  relacjaZOceny,
  charakterystyczneSlowa,
  zapytaniaDoBazy,
  oczyscMeta,
  przeczenie,
  podobienstwo,
};
