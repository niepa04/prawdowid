// normalizacja.js - wyodrębnianie bezpiecznej treści zgłoszenia, normalizacja tekstu,
// wykrywanie podobieństwa wyrazowego (do wstępnej selekcji kandydatów i trybu awaryjnego)
// oraz wyznaczanie granic czasu w strefie Europe/Warsaw.

const crypto = require('crypto');

const MAX_TEKST_ZGLOSZENIA = 1800;

const STOP_SLOWA = new Set([
  'czy', 'nad', 'pod', 'dla', 'jest', 'byly', 'bylo', 'byla', 'byl', 'bedzie',
  'dzis', 'dzisiaj', 'wczoraj', 'jutro', 'teraz', 'obecnie', 'aktualnie', 'ostatnio',
  'jak', 'jaki', 'jaka', 'jakie', 'kto', 'kogo', 'czego', 'gdzie', 'kiedy', 'dlaczego',
  'oraz', 'albo', 'lub', 'przez', 'przy', 'przed', 'miedzy', 'wsrod', 'ktory', 'ktora',
  'ktore', 'ktorych', 'ktorej', 'ktorego', 'ten', 'ta', 'to', 'tym', 'tego', 'tej', 'tych',
  'sie', 'nie', 'tak', 'juz', 'tylko', 'bardzo', 'moze', 'moga', 'mam', 'masz', 'mamy',
  'podobno', 'ponoc', 'slyszalem', 'slyszalam', 'prawda', 'naprawde', 'planowane',
  'polsce', 'polska', 'polski', 'polskim', 'polskie', 'polskich', 'polskiego', 'polacy',
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'that', 'this', 'from', 'have',
]);

// Mapa pokrewnych pojęć wykorzystywana wyłącznie jako wsparcie przy wstępnej selekcji
// kandydatów oraz w trybie awaryjnym bez modelu językowego.
const GRUPY_SYNONIMOW = [
  ['samolot', 'samoloty', 'samolotow', 'mysliwiec', 'mysliwce', 'lot', 'loty', 'lotow', 'lata', 'przelat', 'przelot', 'niebo', 'niebie', 'powietrzn', 'awiacj'],
  ['rakieta', 'rakiety', 'rakiet', 'pocisk', 'pociski', 'dron', 'drony', 'dronow', 'nalot', 'naloty', 'nalotow', 'bomba', 'bomby', 'bomb'],
  ['atak', 'ataki', 'inwazj', 'wojna', 'ostrzel', 'uderz', 'zbrojn'],
  ['woda', 'wodociag', 'kranowk', 'skazen', 'zatruc'],
  ['prad', 'energi', 'elektryczn', 'zasilani', 'blackout', 'awari'],
  ['szczepion', 'szczepieni', 'autyzm', 'chorob', 'epidemi', 'wirus'],
  ['komunikacj', 'autobus', 'tramwaj', 'pociag', 'bilet', 'darmow', 'bezplatn'],
];

const MAPA_SYNONIMOW = new Map();
GRUPY_SYNONIMOW.forEach((grupa, indeks) => {
  const tag = `~syn${indeks}`;
  for (const slowo of grupa) MAPA_SYNONIMOW.set(slowo, tag);
});

function usunPolskieZnaki(tekst) {
  return String(tekst || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (z) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }[z] || z));
}

function wyczyscBialeZnaki(tekst) {
  return String(tekst || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Wyodrębnia z tekstu po Modelu 1 treść właściwą użytkownika (preferuje sekcję [TEKST]).
 * Zakłada, że dane osobowe zostały już usunięte/zablokowane na wcześniejszym etapie.
 */
function wyciagnijTrescDoMonitoringu(tekstPoModelu1) {
  const surowy = String(tekstPoModelu1 || '');
  const sekcje = { TEKST: '', LINKI: '', ZDJĘCIA: '' };
  const maNaglowki = /=====\s*\[[^\]]+\]\s*=====/.test(surowy);

  if (!maNaglowki) {
    return {
      tekstOczyszczony: wyczyscBialeZnaki(surowy).slice(0, MAX_TEKST_ZGLOSZENIA),
      zrodloWejscia: 'tekst',
    };
  }

  let biezaca = 'TEKST';
  for (const czesc of surowy.split(/(=====\s*\[[^\]]+\]\s*=====)/)) {
    const nagl = /^=====\s*\[([^\]]+)\]\s*=====$/.exec(czesc.trim());
    if (nagl) {
      const k = nagl[1].trim().toUpperCase();
      biezaca = k === 'ZDJECIA' ? 'ZDJĘCIA' : k;
      continue;
    }
    const wyczyszczona = wyczyscBialeZnaki(czesc);
    if (wyczyszczona) {
      sekcje[biezaca] = sekcje[biezaca] ? `${sekcje[biezaca]} ${wyczyszczona}` : wyczyszczona;
    }
  }

  const maTekst = sekcje.TEKST.length >= 4;
  const maLinki = sekcje.LINKI.length > 0;
  const maZdjecia = sekcje['ZDJĘCIA'].length > 0;

  let zrodloWejscia = 'tekst';
  if (maTekst && (maLinki || maZdjecia)) zrodloWejscia = 'mieszane';
  else if (!maTekst && maZdjecia) zrodloWejscia = 'zdjecie';
  else if (!maTekst && maLinki) zrodloWejscia = 'link';

  const glowny = maTekst
    ? sekcje.TEKST
    : maZdjecia
      ? `[Ze zdjęcia] ${sekcje['ZDJĘCIA'].slice(0, 700)}`
      : `[Z linku] ${sekcje.LINKI.slice(0, 700)}`;

  return {
    tekstOczyszczony: wyczyscBialeZnaki(glowny).slice(0, MAX_TEKST_ZGLOSZENIA),
    zrodloWejscia,
  };
}

function normalizujDoPorownania(tekst) {
  const bezPrefiksu = String(tekst || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*(czy|podobno|słyszałem|słyszałam|slyszalem|slyszalam|ej)[,\s]+(że\s+|ze\s+)?/iu, '');
  return usunPolskieZnaki(bezPrefiksu)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashTekstu(tekstZnormalizowany) {
  return crypto.createHash('sha256').update(String(tekstZnormalizowany || '')).digest('hex').slice(0, 24);
}

function rdzenSlowa(slowo) {
  const bezPol = usunPolskieZnaki(slowo).replace(/[^a-z0-9]/g, '');
  if (bezPol.length < 3 || STOP_SLOWA.has(bezPol)) return null;
  return bezPol.length > 6 ? bezPol.slice(0, 5) : bezPol.slice(0, 4);
}

function tagSynonimu(slowo) {
  const bezPol = usunPolskieZnaki(slowo).replace(/[^a-z0-9]/g, '');
  if (bezPol.length < 3 || STOP_SLOWA.has(bezPol)) return null;
  for (const [prefiks, tag] of MAPA_SYNONIMOW.entries()) {
    if (bezPol.startsWith(prefiks) || bezPol === prefiks) return tag;
  }
  return null;
}

function tokenyIRdzenie(tekst) {
  const norm = usunPolskieZnaki(tekst).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!norm) return { slowa: new Set(), rdzenie: new Set(), synonimy: new Set() };
  const slowa = new Set();
  const rdzenie = new Set();
  const synonimy = new Set();
  for (const w of norm.split(' ')) {
    if (w.length < 3 || STOP_SLOWA.has(w)) continue;
    slowa.add(w);
    const r = rdzenSlowa(w);
    if (r) rdzenie.add(r);
    const s = tagSynonimu(w);
    if (s) synonimy.add(s);
  }
  return { slowa, rdzenie, synonimy };
}

function podobienstwoSlowne(tekst, klaster) {
  const a = tokenyIRdzenie(tekst);
  const wzorzecKlastra = [
    klaster.tytul || '',
    klaster.kanoniczne_pytanie || '',
    ...(Array.isArray(klaster.slowa_kluczowe) ? klaster.slowa_kluczowe : []),
  ].join(' ');
  const b = tokenyIRdzenie(wzorzecKlastra);
  if (!a.rdzenie.size || !b.rdzenie.size) return { wynik: 0, wspolneRdzenie: 0 };

  let wspolneRdzenie = 0;
  for (const r of a.rdzenie) {
    if (b.rdzenie.has(r)) wspolneRdzenie++;
  }
  let wspolneSynonimy = 0;
  for (const s of a.synonimy) {
    if (b.synonimy.has(s)) wspolneSynonimy++;
  }
  const dopasowania = wspolneRdzenie + wspolneSynonimy * 0.6;
  if (!dopasowania) return { wynik: 0, wspolneRdzenie: 0 };

  const jaccard = wspolneRdzenie / Math.max(1, a.rdzenie.size + b.rdzenie.size - wspolneRdzenie);
  const pokrycieA = Math.min(1, dopasowania / a.rdzenie.size);
  const pokrycieB = Math.min(1, dopasowania / b.rdzenie.size);
  const maxPokrycie = Math.max(pokrycieA, pokrycieB);
  const synBonus = Math.min(0.35, wspolneSynonimy * 0.25);
  return {
    wynik: Math.min(1, 0.35 * jaccard + 0.55 * maxPokrycie + synBonus),
    wspolneRdzenie: wspolneRdzenie + wspolneSynonimy,
  };
}

function czesciCzasuWStrefie(data, strefa) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: strefa,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const czesci = {};
  for (const p of fmt.formatToParts(data)) {
    if (p.type !== 'literal') czesci[p.type] = Number(p.value);
  }
  return czesci;
}

/**
 * Zwraca granice czasu (UTC ISO) dla dnia lokalnego w zadanej strefie (domyślnie Europe/Warsaw).
 */
function graniceCzasowe(teraz = new Date(), strefa = 'Europe/Warsaw') {
  const ref = teraz instanceof Date ? teraz : new Date(teraz);
  const lokalne = czesciCzasuWStrefie(ref, strefa);
  const dataDnia = `${lokalne.year}-${String(lokalne.month).padStart(2, '0')}-${String(lokalne.day).padStart(2, '0')}`;

  // Północ dnia lokalnego w UTC przez iteracyjne wyliczenie przesunięcia strefy (obsługuje zmianę czasu)
  const utcPolnoc = Date.UTC(lokalne.year, lokalne.month - 1, lokalne.day, 0, 0, 0, 0);
  const probe1 = czesciCzasuWStrefie(new Date(utcPolnoc), strefa);
  const lokalProbe1Ms = Date.UTC(probe1.year, probe1.month - 1, probe1.day, probe1.hour, probe1.minute, probe1.second);
  let startDniaMs = utcPolnoc - (lokalProbe1Ms - utcPolnoc);

  const probe2 = czesciCzasuWStrefie(new Date(startDniaMs), strefa);
  const lokalProbe2Ms = Date.UTC(probe2.year, probe2.month - 1, probe2.day, probe2.hour, probe2.minute, probe2.second);
  startDniaMs -= lokalProbe2Ms - utcPolnoc;

  return {
    dataDnia,
    terazIso: ref.toISOString(),
    poczatekDniaIso: new Date(startDniaMs).toISOString(),
    godzinaTemuIso: new Date(ref.getTime() - 60 * 60 * 1000).toISOString(),
    siedemDniTemuIso: new Date(startDniaMs - 7 * 24 * 3600 * 1000).toISOString(),
  };
}

function bezpiecznyKluczKanoniczny(tekst) {
  const baza = usunPolskieZnaki(tekst)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return baza || `temat-${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = {
  MAX_TEKST_ZGLOSZENIA,
  wyciagnijTrescDoMonitoringu,
  normalizujDoPorownania,
  hashTekstu,
  tokenyIRdzenie,
  podobienstwoSlowne,
  graniceCzasowe,
  bezpiecznyKluczKanoniczny,
  wyczyscBialeZnaki,
};
