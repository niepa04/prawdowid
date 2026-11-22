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
// Lista fact-checkerów i adres API: config/zrodla/fact_checkerzy.json
const { factCheckerzy } = require('../../../config').zrodla;

const API_URL = factCheckerzy.google_fact_check_api.adres;
const JEZYK_API = factCheckerzy.google_fact_check_api.jezyk;
const FACTCHECK_MAX_DOWODOW = 3;
const TIMEOUT_MS = 6000;

// Zaufani fact-checkerzy piszący po polsku (sygnatariusze IFCN). Tylko ich oceny są brane pod uwagę,
// i tylko te hosty przepuszcza końcowa zapora wyszukiwarki dowodów (validators/evidenceValidator.js).
const ZAUFANI_FACT_CHECKERZY = new Set(factCheckerzy.zaufani);

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

// Zapytania do bazy Google. Wyszukiwarka wymaga WSZYSTKICH słów zapytania w dokładnej formie,
// a oceniane twierdzenie bywa sformułowane zupełnie inaczej niż zgłoszenie (np. długi cytat
// polityka zamiast pytania użytkownika). Dlatego zamiast kilku zapytań generujemy wiele:
// - najważniejsze słowa razem,
// - sąsiednie słowa ze zdania (trójki i pary),
// - KAŻDA para i trójka najważniejszych słów (różne rdzenie), także odmian i synonimów z planu,
// - pojedyncze najważniejsze słowa.
// Liczby zostają razem ze słowem ("65-latków") i osobno ("65").
const MAX_ZAPYTAN = 40;
const MAX_SLOW_PARY = 10;
const MAX_SLOW_TROJKI = 6;
// Słowa tak pospolite w polskich fact-checkach, że zapytanie z nimi zwraca przypadkowe wyniki
const POSPOLITE_W_ZAPYTANIU = /^(polsk|polac|polak|polsce)/i;
const WZOR_SLOWA = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;

const znaczace = (w) => (w.length >= 3 || /\d/.test(w)) && !SLOWA_POMIJANE.has(w.toLowerCase()) && !POSPOLITE_W_ZAPYTANIU.test(w);

// rozbijaj: "65-latków" -> także "65" i "latków" (różne zapisy w bazie: "65-latkowie", "65 lat")
function slowaZnaczace(tekst, rozbijaj = true) {
  const wynik = [];
  for (const s of String(tekst || '').match(WZOR_SLOWA) || []) {
    wynik.push(s);
    if (rozbijaj && s.includes('-')) wynik.push(...s.split('-'));
  }
  return wynik.filter(znaczace);
}

function zapytaniaDoBazy(tekst, slowaDodatkowe = []) {
  const slowa = slowaZnaczace(tekst, false);
  const dodatkowe = slowaZnaczace(slowaDodatkowe.join(' '), false);
  // Wielka litera tylko na początku zdania nie oznacza nazwy własnej - chyba że plan researchu
  // podał to słowo z wielkiej litery (np. "Czy Wrocław..." -> po usunięciu "Czy" Wrocław jest pierwszy)
  const pierwsze = String(tekst).trim().match(WZOR_SLOWA)?.[0];
  const nazwyZPlanu = new Set(dodatkowe.filter((x) => /^\p{Lu}/u.test(x)).map(rdzen));
  const w = (x) => waga(x, x === pierwsze && !nazwyZPlanu.has(rdzen(x)) ? 0 : 1) + (/\d/.test(x) ? 6 : 0);
  // Jedno słowo na rdzeń w czołówce (inaczej "65-latkowie", "65-latków" zajmują wszystkie miejsca);
  // słowa użytkownika mają pierwszeństwo przed odmianami i synonimami z planu
  const ranking = new Map();
  for (const x of slowa) {
    const r = rdzen(x);
    if (!ranking.has(r) || ranking.get(r).p < w(x) + 5) ranking.set(r, { x, p: w(x) + 5 });
  }
  const odmiany = [];
  for (const x of dodatkowe) {
    const r = rdzen(x);
    if (!ranking.has(r)) ranking.set(r, { x, p: w(x) });
    else if (ranking.get(r).x.toLowerCase() !== x.toLowerCase()) odmiany.push(x);
  }
  const czolowka = [...ranking.values()].sort((a, b) => b.p - a.p).map((r) => r.x);
  // Inne formy tego samego słowa idą za czołówką: trafiają do par z najważniejszymi słowami
  const pojedyncze = [...czolowka.slice(0, 4), ...odmiany, ...czolowka.slice(4)];
  const czesci = slowaZnaczace(tekst).filter((x) => !slowa.includes(x));

  const ngramy = [];
  for (const n of [3, 2]) {
    for (let i = 0; i + n <= slowa.length; i++) {
      const czesc = slowa.slice(i, i + n);
      ngramy.push({ q: czesc.join(' '), n, w: czesc.reduce((s, x) => s + w(x), 0) / n + n });
    }
  }
  ngramy.sort((a, b) => b.w - a.w);

  // Kombinacje słów o RÓŻNYCH rdzeniach ("Wrocław" z "Wrocławiu" nic nie daje)
  const rozne = (...xs) => new Set(xs.map(rdzen)).size === xs.length;
  const pary = [];
  const doPar = pojedyncze.slice(0, MAX_SLOW_PARY);
  for (let i = 0; i < doPar.length; i++) {
    for (let j = i + 1; j < doPar.length; j++) if (rozne(doPar[i], doPar[j])) pary.push(`${doPar[i]} ${doPar[j]}`);
  }
  const trojki = [];
  const doTrojek = pojedyncze.slice(0, MAX_SLOW_TROJKI);
  for (let i = 0; i < doTrojek.length; i++) {
    for (let j = i + 1; j < doTrojek.length; j++) {
      for (let k = j + 1; k < doTrojek.length; k++) {
        if (rozne(doTrojek[i], doTrojek[j], doTrojek[k])) trojki.push(`${doTrojek[i]} ${doTrojek[j]} ${doTrojek[k]}`);
      }
    }
  }

  const kolejnosc = [
    pojedyncze.slice(0, 3).join(' '),
    ...ngramy.filter((x) => x.n === 3).slice(0, 2).map((x) => x.q),
    ...ngramy.filter((x) => x.n === 2).slice(0, 2).map((x) => x.q),
    ...trojki.slice(0, 10),
    ...pary,
    ...czolowka.slice(0, 4),
    ...czesci.slice(0, 2),
  ];
  return [...new Set(kolejnosc.filter(Boolean))].slice(0, MAX_ZAPYTAN);
}

// Rdzeń do porównań: małe litery bez polskich znaków, 5 pierwszych liter
// ("jeździli"/"jeżdżą" -> "jezdz", "65-latkowie"/"65-latków" -> "latko", "darmo"/"darmowa" -> "darmo")
function rdzen(w) {
  const t = String(w).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
  return /^\d+$/.test(t) ? t : t.slice(0, 5);
}

function rdzenie5(tekst) {
  return new Set(slowaZnaczace(tekst).filter((w) => !w.includes('-')).map(rdzen));
}

// Jaka część znaczących słów użytkownika występuje w ocenianym twierdzeniu (0..1).
// W przeciwieństwie do podobieństwa nie karze za to, że cytat polityka jest długi.
// Warunki, żeby nie łapać innych wypowiedzi o tych samych osobach:
// - co najmniej 2 wspólne słowa poza nazwami własnymi ("Karol Nawrocki" + "prezydent" to za mało),
// - liczby ze zgłoszenia muszą być w ocenie ("zakaz od 2025" to nie "zakaz od 2035").
function pokrycie(tekstUzytkownika, tekstOceny) {
  const U = rdzenie5(tekstUzytkownika);
  const D = rdzenie5(tekstOceny);
  if (U.size < 3) return 0;
  const nazwy = new Set(slowaZnaczace(tekstUzytkownika).filter((w) => /^\p{Lu}/u.test(w)).map(rdzen));
  let wspolne = 0;
  let wspolneZwykle = 0;
  for (const r of U) {
    if (!D.has(r)) continue;
    wspolne++;
    if (!nazwy.has(r)) wspolneZwykle++;
  }
  const liczby = [...U].filter((r) => /^\d+$/.test(r));
  if (liczby.some((l) => !D.has(l))) return 0;
  return wspolne >= 3 && wspolneZwykle >= 2 ? wspolne / U.size : 0;
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
const MIN_PODOBIENSTWO_TYTULU = 0.5;
const MIN_POKRYCIE = 0.6;
const MIN_PODOBIENSTWO_ARTYKULU = 0.35;

// Tytuł artykułu fact-checkera bez dopisków ("...", "Sprawdzamy", "Fakt czy fake?")
function czystyTytul(tytul) {
  return String(tytul || '')
    .replace(/(\.\.\.|…)\s*$/, '')
    .replace(/\b(sprawdzamy|sprawdziliśmy|wyjaśniamy|fakt czy fake|prawda czy fałsz)\b[?!.]*/gi, ' ')
    .trim();
}

// Jak bardzo ocena z bazy pasuje do zgłoszenia: najlepszy z trzech sposobów porównania
function dopasowanieOceny(warianty, c, { ignorujLiczby = false } = {}) {
  const tytuly = (c.claimReview || []).map((r) => czystyTytul(r?.title)).filter(Boolean);
  const liczby = (t) => new Set(String(t || '').match(/\d+/g) || []);
  const liczbyOceny = liczby(`${c.text} ${tytuly.join(' ')}`);
  let najlepsze = 0;
  for (const w of warianty) {
    // Sprzeczne liczby: zgłoszenie mówi o 2025, ocena o 2035 - to inna sprawa
    const liczbyW = liczby(w);
    if (!ignorujLiczby && liczbyW.size && liczbyOceny.size && ![...liczbyW].some((l) => liczbyOceny.has(l))) continue;
    najlepsze = Math.max(
      najlepsze,
      podobienstwo(w, c.text) / MIN_PODOBIENSTWO,
      ...tytuly.map((t) => podobienstwo(w, t) / MIN_PODOBIENSTWO_TYTULU),
      pokrycie(w, `${c.text} ${tytuly.join(' ')}`) / MIN_POKRYCIE
    );
  }
  return najlepsze; // >= 1 oznacza "pasuje"
}

// Fact-checkerzy, których artykuły Model 3 otwiera i czyta (muszą być w katalogu źródeł).
const HOSTY_PRZEGLADANE = new Set(factCheckerzy.przegladani);
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
  'którym', 'której', 'których', 'czy', 'sprawdzamy', 'sprawdźmy', 'prawda', 'naprawdę', 'został', 'zostały',
]);

const cache = new Map();

async function zapytajApi(query, apiKey) {
  const klucz = query.toLowerCase();
  const zapamietane = cache.get(klucz);
  if (zapamietane && Date.now() - zapamietane.czas < 10 * 60 * 1000) return zapamietane.claims;

  const url = `${API_URL}?query=${encodeURIComponent(query)}&languageCode=${encodeURIComponent(JEZYK_API)}&pageSize=10&key=${encodeURIComponent(apiKey)}`;
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
  // Wszystkie zapytania ze wszystkich wariantów brzmienia + odmiany i synonimy z planu researchu.
  // Bez przerywania po pierwszym trafieniu: lepsza ocena może przyjść z dalszego zapytania.
  const slowaDodatkowe = Array.isArray(claim.search_keywords) ? claim.search_keywords.map(String) : [];
  const wszystkieZapytania = [...new Set(warianty.flatMap((w) => zapytaniaDoBazy(w, slowaDodatkowe)))].slice(0, MAX_ZAPYTAN * 2);
  let nieudane = 0;
  let ostatniBlad = null;
  const widziane = new Set();
  const ROWNOLEGLE = 8;
  for (let i = 0; i < wszystkieZapytania.length; i += ROWNOLEGLE) {
    const paczka = await Promise.all(
      wszystkieZapytania.slice(i, i + ROWNOLEGLE).map((q) =>
        zapytajApi(q, apiKey).catch((err) => {
          nieudane++;
          ostatniBlad = err;
          return [];
        })
      )
    );
    for (const c of paczka.flat()) {
      const klucz = `${c.text}|${c.claimReview?.[0]?.url}`;
      if (!widziane.has(klucz)) {
        widziane.add(klucz);
        wyniki.push(c);
      }
    }
  }
  if (nieudane === wszystkieZapytania.length && nieudane > 0) {
    return { evidence: [], warnings: [`Baza fact-checkerów Google była niedostępna (${ostatniBlad?.message}).`], artykuly: [] };
  }

  const evidence = [];
  const artykuly = []; // { url, podobne } - artykuły z hostów przeglądanych przez Model 3 (Demagog)
  for (const c of wyniki) {
    const podobne = dopasowanieOceny(warianty, c);

    // Artykuły na pokrewny temat warto przeczytać, nawet jeśli dotyczą nieco innego twierdzenia
    // (także z inną liczbą/datą - np. artykuł o zakazie od 2035 r. odpowiada na pytanie o 2025 r.):
    // ich treść i tak przechodzi później przez zwykły matcher Modelu 3.
    const podobneTemat = Math.max(podobne, dopasowanieOceny(warianty, c, { ignorujLiczby: true }));
    if (podobneTemat >= MIN_PODOBIENSTWO_ARTYKULU / MIN_PODOBIENSTWO) {
      for (const r of c.claimReview || []) {
        if (r?.url && hostPrzegladany(r.url)) artykuly.push({ url: r.url, podobne: podobneTemat });
      }
    }

    // Ocena dotyczy innego twierdzenia, które tylko dzieli z naszym kilka słów
    if (podobne < 1) continue;
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
      dopasowanie.relevance = podobne >= 0.75 / MIN_PODOBIENSTWO ? 'direct' : 'partial';
      dopasowanie._matchScore = Math.max(dopasowanie._matchScore || 0, podobne);

      // Przeczenie: "szczepionki NIE powodują autyzmu" jest podobne słownie do "szczepionki powodują
      // autyzm", ale znaczy odwrotnie. Wtedy ocena fact-checkera dotyczy twierdzenia PRZECIWNEGO.
      // Tylko dla krótkich twierdzeń: w długim cytacie "nie" zwykle dotyczy czegoś innego
      // ("nie 70, tylko 65-latkowie..." nie jest zaprzeczeniem całej wypowiedzi).
      const krotkie = String(c.text || '').split(/\s+/).length <= 20;
      const przeciwne = krotkie && przeczenie(warianty[0]) !== przeczenie(c.text);
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
  pokrycie,
  dopasowanieOceny,
};
