// zaufaneDomeny.js - czy link ze zgłoszenia prowadzi do domeny, na której Koma sama weryfikuje informacje.
//
// Zaufane domeny to te same listy, z których korzysta wyszukiwarka dowodów:
//   config/zrodla/zrodla_oficjalne.json  (źródła urzędowe + Demagog)
//   config/zrodla/fact_checkerzy.json    (zaufani fact-checkerzy)
//
// Zaufane źródło NIE kończy sprawdzania: informujemy użytkownika, że link pochodzi ze zweryfikowanego
// źródła, ale potwierdzeń i tak szukamy na innych stronach (sama strona z linku jest wykluczana
// z materiałów - nie może potwierdzać sama siebie).

const { createSourceRegistry } = require('../wyszukiwarka_dowodow/sourceRegistry');
const { factCheckerzy } = require('../../config').zrodla;

const WZOR_LINKU = /https?:\/\/[^\s<>"'`()[\]{}]+/gi;

let _rejestr = null;
function rejestr() {
  if (!_rejestr) _rejestr = createSourceRegistry();
  return _rejestr;
}

const bezWww = (host) => String(host || '').toLowerCase().replace(/^www\./, '');

// Linki podane w polu "linki" oraz wklejone w tekst (bez końcowej interpunkcji, bez powtórzeń)
function linkiZgloszenia(dane) {
  const zTekstu = String(dane?.tekst || '').match(WZOR_LINKU) || [];
  const wszystkie = [...(dane?.linki || []), ...zTekstu].map((l) => String(l).replace(/[.,;:!?)\]]+$/, ''));
  return [...new Set(wszystkie)].filter((l) => {
    try {
      return ['http:', 'https:'].includes(new URL(l).protocol);
    } catch {
      return false;
    }
  });
}

// Adres do porównań: host bez www, ścieżka bez końcowego "/", bez parametrów i kotwicy
function kluczUrl(url) {
  try {
    const u = new URL(url);
    return `${bezWww(u.hostname)}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

/**
 * Sprawdza, które linki prowadzą do zaufanych domen.
 * @param {string[]} linki
 * @returns {{url: string, host: string, rodzaj: 'oficjalne'|'fact-checker', nazwa: string}[]}
 */
function zaufaneLinki(linki) {
  const r = rejestr();
  const hostyOficjalne = new Set([...r.allowedHosts].map(bezWww));
  const hostyFactCheckerow = new Set(factCheckerzy.zaufani.map(bezWww));
  const wynik = [];
  for (const url of linki || []) {
    let host;
    try {
      host = bezWww(new URL(url).hostname);
    } catch {
      continue;
    }
    if (hostyFactCheckerow.has(host)) {
      wynik.push({ url, host, rodzaj: 'fact-checker', nazwa: `${host} – niezależny fact-checker` });
      continue;
    }
    if (!hostyOficjalne.has(host)) continue;
    // Nazwa konkretnego źródła tylko wtedy, gdy link leży pod jego adresem; inaczej sama domena
    // (najdłuższa pasująca ścieżka; przy remisie źródło bez kotwicy "#", np. ogólnopolskie zamiast wojewódzkiego)
    let nazwa = `${host} – domena z listy zaufanych źródeł`;
    const klucz = kluczUrl(url);
    const pasujace = r.enabledSources
      .filter((s) => bezWww(s.hostname) === host && klucz.startsWith(kluczUrl(s.url.split('#')[0])))
      .sort((a, b) => kluczUrl(b.url.split('#')[0]).length - kluczUrl(a.url.split('#')[0]).length || a.url.includes('#') - b.url.includes('#'));
    if (pasujace[0]) nazwa = pasujace[0].name;
    wynik.push({ url, host, rodzaj: host === 'demagog.org.pl' ? 'fact-checker' : 'oficjalne', nazwa });
  }
  return wynik;
}

module.exports = { linkiZgloszenia, zaufaneLinki, kluczUrl };
