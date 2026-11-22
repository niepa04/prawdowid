// daneOsobowe.js - FILTR DANYCH OSOBOWYCH. Działa na tekście po Modelu 1 (tekst + OCR zdjęć +
// treść stron z linków), ZANIM cokolwiek trafi do researchu, modeli czy zewnętrznych wyszukiwarek.
//
// Wykrywa dane, które identyfikują konkretną osobę prywatną:
//   - PESEL, numer dowodu osobistego, numer paszportu (z walidacją sum kontrolnych),
//   - numer konta bankowego (IBAN, suma kontrolna mod 97) i numer karty płatniczej (algorytm Luhna),
//   - numer telefonu komórkowego albo numer oznaczony jako telefon, adres e-mail,
//   - adres zamieszkania: ulica z numerem mieszkania ("Kwiatowa 5/12", "m. 3") albo adres
//     w kontekście zamieszkania ("mieszka przy ul. ...", "zam. ...", "adres zamieszkania").
// Sumy kontrolne odsiewają przypadkowe liczby (kwoty, numery ustaw), więc fałszywych alarmów jest mało.
// Imiona, nazwiska i daty urodzenia osób publicznych NIE są blokowane - to normalna treść zgłoszeń.
// Przypadki, których reguły nie złapią (np. imię i nazwisko osoby prywatnej + choroba), ocenia
// model w filtrze wstępnym (kategoria "dane_osobowe").
//
// Tekst użytkownika i zdjęć: wykryte dane BLOKUJĄ zgłoszenie.
// Treść publicznych stron z linków: wykryte dane są WYCINANE (strona nie jest od użytkownika,
// a np. stopka z telefonem redakcji nie powinna blokować sprawdzenia artykułu).

const ZAMIENNIK = '[usunięto dane osobowe]';

// ---- Walidatory ----

function poprawnyPesel(p) {
  if (!/^\d{11}$/.test(p)) return false;
  const c = p.split('').map(Number);
  const wagi = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const suma = wagi.reduce((s, w, i) => s + w * c[i], 0);
  if ((10 - (suma % 10)) % 10 !== c[10]) return false;
  const miesiac = (c[2] * 10 + c[3]) % 20;
  const dzien = c[4] * 10 + c[5];
  return miesiac >= 1 && miesiac <= 12 && dzien >= 1 && dzien <= 31;
}

const wartoscZnaku = (z) => (/\d/.test(z) ? Number(z) : z.charCodeAt(0) - 55); // A=10 ... Z=35

// Dowód osobisty: ABC123456, cyfra kontrolna na 4. pozycji
function poprawnyDowod(n) {
  if (!/^[A-Z]{3}\d{6}$/.test(n)) return false;
  const wagi = [7, 3, 1, 0, 7, 3, 1, 7, 3];
  const suma = n.split('').reduce((s, z, i) => s + wagi[i] * wartoscZnaku(z), 0);
  return suma % 10 === Number(n[3]);
}

// Paszport: AB1234567, cyfra kontrolna na 3. pozycji
function poprawnyPaszport(n) {
  if (!/^[A-Z]{2}\d{7}$/.test(n)) return false;
  const wagi = [7, 3, 0, 1, 7, 3, 1, 7, 3];
  const suma = n.split('').reduce((s, z, i) => s + wagi[i] * wartoscZnaku(z), 0);
  return suma % 10 === Number(n[2]);
}

// Polski numer konta (26 cyfr, opcjonalnie z PL): IBAN mod 97 == 1
function poprawneKonto(cyfry) {
  if (!/^\d{26}$/.test(cyfry)) return false;
  const iban = `${cyfry.slice(2)}2521${cyfry.slice(0, 2)}`; // PL = 25 21
  let reszta = 0;
  for (const z of iban) reszta = (reszta * 10 + Number(z)) % 97;
  return reszta === 1;
}

function poprawnaKarta(cyfry) {
  if (!/^\d{13,19}$/.test(cyfry) || /^(\d)\1+$/.test(cyfry)) return false;
  let suma = 0;
  for (let i = 0; i < cyfry.length; i++) {
    let d = Number(cyfry[cyfry.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
  }
  return suma % 10 === 0;
}

// ---- Wykrywacze ----
// Każdy zwraca listę { typ, start, koniec } (pozycje w tekście, do wycinania).

const OPISY = {
  pesel: 'numer PESEL',
  dowod: 'numer dowodu osobistego',
  paszport: 'numer paszportu',
  konto: 'numer konta bankowego',
  karta: 'numer karty płatniczej',
  telefon: 'numer telefonu',
  email: 'adres e-mail',
  adres: 'adres zamieszkania',
};

function znajdz(tekst, wzor, typ, warunek = () => true) {
  const wynik = [];
  for (const m of tekst.matchAll(wzor)) {
    if (warunek(m)) wynik.push({ typ, start: m.index, koniec: m.index + m[0].length });
  }
  return wynik;
}

const tylkoCyfry = (s) => s.replace(/\D/g, '');

// Komórki w Polsce: 45, 50, 51, 53, 57, 60, 66, 69, 72, 73, 78, 79, 88
const PREFIKSY_KOMORKOWE = /^(45|50|51|53|57|60|66|69|72|73|78|79|88)/;

// Słowa wskazujące, że adres to miejsce zamieszkania konkretnej osoby
const KONTEKST_ZAMIESZKANIA =
  /(mieszka\w*|zamieszka\w*|zameldowan\w*|\bzam\.|adres\w*\s+zamieszkania|(mój|moj|jego|jej|ich)\s+adres|pod\s+adresem|mieszkani\w+\s+(przy|na)|dom\w*\s+(przy|na))/i;

// Ulica + numer (+ ewentualnie numer mieszkania)
const WZOR_ULICY =
  /\b(?:ul\.|ulic[ay]|al\.|alej[ai]|aleja|os\.|osiedl[eu]|pl\.|plac[u]?)\s*(?:\p{Lu}[\p{L}.'-]*\s+){0,3}?\p{Lu}?[\p{L}.'-]+\s+(\d{1,4}[a-zA-Z]?)(\s*(?:\/\s*\d{1,4}[a-zA-Z]?|(?:m\.|m|lok\.|lokal|mieszkani[ea])\s*\d{1,4}))?(?!\s*\/\s*\d)/gu;
const WZOR_KODU = /\b\d{2}-\d{3}\s+\p{Lu}[\p{Ll}]+/gu;

function wykryjAdresy(tekst) {
  const wynik = [];
  for (const m of tekst.matchAll(WZOR_ULICY)) {
    const start = m.index;
    const koniec = start + m[0].length;
    const mieszkanie = Boolean(m[2]); // "5/12", "5 m. 12" - lokal mieszkalny
    const otoczenie = tekst.slice(Math.max(0, start - 80), Math.min(tekst.length, koniec + 40));
    if (mieszkanie || KONTEKST_ZAMIESZKANIA.test(otoczenie)) wynik.push({ typ: 'adres', start, koniec });
  }
  for (const m of tekst.matchAll(WZOR_KODU)) {
    const otoczenie = tekst.slice(Math.max(0, m.index - 80), Math.min(tekst.length, m.index + m[0].length + 40));
    if (KONTEKST_ZAMIESZKANIA.test(otoczenie)) wynik.push({ typ: 'adres', start: m.index, koniec: m.index + m[0].length });
  }
  return wynik;
}

/**
 * Znajduje dane osobowe w tekście.
 * @param {string} tekst
 * @returns {{typ: string, opis: string, start: number, koniec: number}[]}
 */
function wykryjDaneOsobowe(tekst) {
  const t = String(tekst || '');
  const znalezione = [
    ...znajdz(t, /(?<![\d-])\d{11}(?![\d-])/g, 'pesel', (m) => poprawnyPesel(m[0])),
    ...znajdz(t, /\b([A-Z]{3})\s?(\d{6})\b/g, 'dowod', (m) => poprawnyDowod(m[1] + m[2])),
    ...znajdz(t, /\b([A-Z]{2})\s?(\d{7})\b/g, 'paszport', (m) => poprawnyPaszport(m[1] + m[2])),
    ...znajdz(t, /\b(?:PL\s?)?\d{2}(?:[ -]?\d{4}){6}\b/g, 'konto', (m) => poprawneKonto(tylkoCyfry(m[0]))),
    ...znajdz(t, /(?<![\d-])\d{4}(?:[ -]?\d{4}){2}[ -]?\d{1,7}(?![\d-])/g, 'karta', (m) => {
      const c = tylkoCyfry(m[0]);
      return c.length >= 13 && c.length <= 19 && poprawnaKarta(c) && !poprawneKonto(c) && !poprawnyPesel(c);
    }),
    // Telefon: komórka (+48 600 123 456, 600-123-456, 600123456) albo numer po słowie "tel."
    // (także stacjonarny "22 694 70 00"). Nie fragment dłuższej liczby ani kwota ("3 450 123 456 zł").
    ...znajdz(t, /(?<![\d+][ -]?|[\d+,.])(?:(?:\+|00)48[ -]?)?(?:\d{3}[ -]?\d{3}[ -]?\d{3}|\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2})(?![ -]?\d|[,.]\d)/g, 'telefon', (m) => {
      const c = tylkoCyfry(m[0]).replace(/^(00)?48(?=\d{9}$)/, '');
      if (c.length !== 9) return false;
      const po = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
      if (/^\s*(zł|złot|pln|eur|euro|€|\$|usd|%|proc|tys|mln|mld|osób|ludzi|km|kg|r\.|rok)/i.test(po)) return false;
      const przed = t.slice(Math.max(0, m.index - 25), m.index);
      const poSlowieTel = /(tel\.?|telefon\w*|komórk\w*|nr\.?\s*tel\.?|dzwoń|zadzwoń|sms)\s*:?\s*$/i.test(przed);
      const komorka = /^\d{3}[ -]?\d{3}[ -]?\d{3}$/.test(m[0].replace(/^(\+|00)48[ -]?/, '')) && PREFIKSY_KOMORKOWE.test(c);
      return komorka || poSlowieTel;
    }),
    ...znajdz(t, /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu, 'email', (m) => !/@([\w-]+\.)*gov\.pl$/i.test(m[0])),
    ...wykryjAdresy(t),
  ];
  // Karta i konto to te same cyfry - zostaw dłuższe dopasowanie, bez nakładania się
  znalezione.sort((a, b) => a.start - b.start || b.koniec - a.koniec);
  const bezNakladania = [];
  for (const z of znalezione) {
    const ostatni = bezNakladania[bezNakladania.length - 1];
    if (ostatni && z.start < ostatni.koniec) continue;
    bezNakladania.push({ ...z, opis: OPISY[z.typ] });
  }
  return bezNakladania;
}

function wytnij(tekst, znalezione) {
  let wynik = tekst;
  for (const z of [...znalezione].sort((a, b) => b.start - a.start)) {
    wynik = wynik.slice(0, z.start) + ZAMIENNIK + wynik.slice(z.koniec);
  }
  return wynik;
}

/**
 * Sprawdza tekst po Modelu 1 (z sekcjami ===== [TEKST] / [LINKI] / [ZDJĘCIA] =====).
 * @returns {{zablokuj: boolean, wykryte: string[], tekst: string, wycietoZLinkow: number}}
 *   zablokuj - dane osobowe w tekście użytkownika lub na zdjęciach,
 *   wykryte  - rodzaje danych (bez samych wartości - tych nie zapisujemy ani nie odsyłamy),
 *   tekst    - tekst z wyciętymi danymi (dane ze stron z linków są usuwane, a nie blokowane).
 */
function sprawdzDaneOsobowe(tekstModelu1) {
  const tekst = String(tekstModelu1 || '');
  const czesci = tekst.split(/(=====\s*\[[^\]]+\]\s*=====)/);
  const wykryte = new Set();
  let zablokuj = false;
  let wycietoZLinkow = 0;
  let sekcja = 'TEKST';
  const wynik = czesci.map((c) => {
    const naglowek = /=====\s*\[([^\]]+)\]\s*=====/.exec(c);
    if (naglowek) {
      sekcja = naglowek[1].trim().toUpperCase();
      return c;
    }
    const znalezione = wykryjDaneOsobowe(c);
    if (!znalezione.length) return c;
    if (sekcja === 'LINKI') {
      wycietoZLinkow += znalezione.length;
    } else {
      zablokuj = true;
      znalezione.forEach((z) => wykryte.add(z.opis));
    }
    return wytnij(c, znalezione);
  });
  return { zablokuj, wykryte: [...wykryte], tekst: wynik.join(''), wycietoZLinkow };
}

module.exports = {
  sprawdzDaneOsobowe,
  wykryjDaneOsobowe,
  poprawnyPesel,
  poprawnyDowod,
  poprawnyPaszport,
  poprawneKonto,
  poprawnaKarta,
  ZAMIENNIK,
};
