#!/usr/bin/env node
// test_werdyktow.js - testuje werdykty Komy na zestawie 100 zapytań i zapisuje raport tekstowy.
//
// Uruchomienie (z głównego folderu projektu):
//   node testy/test_werdyktow.js                    -> wywołuje pipeline bezpośrednio (bez serwera)
//   node testy/test_werdyktow.js --url http://localhost:3000   -> testuje działający serwer przez /api/weryfikuj
//   node testy/test_werdyktow.js --limit 10         -> tylko pierwsze 10 zapytań
//   node testy/test_werdyktow.js --temat PPK        -> tylko tematy zawierające "PPK"
//
// Raport: testy/raporty/raport_RRRR-MM-DD_GG-MM.txt (dopisywany na bieżąco, podsumowanie na końcu).
// Zapytania idą po kolei, żeby nie przeciążać serwera modeli. 100 zapytań to ok. 40-60 minut.

const fs = require('fs');
const path = require('path');

const KORZEN = path.join(__dirname, '..');
try {
  process.loadEnvFile(path.join(KORZEN, '.env'));
} catch {
  // brak .env - działamy bez klucza do bazy fact-checkerów
}

const PRZYPADKI = require('./przypadki');
const LIMIT_CZASU_MS = 5 * 60 * 1000;

// --- argumenty ---
const argumenty = process.argv.slice(2);
const arg = (nazwa) => {
  const i = argumenty.indexOf(nazwa);
  return i >= 0 ? argumenty[i + 1] : null;
};
const URL_SERWERA = arg('--url');
const LIMIT = Number(arg('--limit')) || Infinity;
const FILTR_TEMATU = (arg('--temat') || '').toLowerCase();

// --- lista zapytań ---
const zapytania = [];
for (const t of PRZYPADKI) {
  if (FILTR_TEMATU && !t.temat.toLowerCase().includes(FILTR_TEMATU)) continue;
  for (const [tekst, oczekiwany] of t.zapytania) {
    zapytania.push({ temat: t.temat, kategoria: t.kategoria, zrodlo: t.zrodlo, tekst, oczekiwany });
  }
}
const doWykonania = zapytania.slice(0, LIMIT);

// --- plik raportu ---
const folder = path.join(__dirname, 'raporty');
fs.mkdirSync(folder, { recursive: true });
const teraz = new Date();
const dwa = (n) => String(n).padStart(2, '0');
const plik = path.join(
  folder,
  `raport_${teraz.getFullYear()}-${dwa(teraz.getMonth() + 1)}-${dwa(teraz.getDate())}_${dwa(teraz.getHours())}-${dwa(teraz.getMinutes())}.txt`
);
const zapisz = (tekst = '') => fs.appendFileSync(plik, tekst + '\n', 'utf8');

// --- wywołanie Komy ---
let pipeline = null;
async function sprawdz(tekst) {
  if (URL_SERWERA) {
    const odp = await fetch(`${URL_SERWERA.replace(/\/+$/, '')}/api/weryfikuj`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tekst }),
      signal: AbortSignal.timeout(LIMIT_CZASU_MS),
    });
    const dane = await odp.json().catch(() => null);
    if (!odp.ok) throw new Error(dane?.blad || `HTTP ${odp.status}`);
    return dane;
  }
  pipeline = pipeline || require(path.join(KORZEN, 'app', 'pipeline'));
  return Promise.race([
    pipeline.uruchomPipeline({ tekst }),
    new Promise((_, nie) => setTimeout(() => nie(new Error(`przekroczono ${LIMIT_CZASU_MS / 60000} min`)), LIMIT_CZASU_MS)),
  ]);
}

const skroc = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// --- główna pętla ---
(async () => {
  zapisz('RAPORT TESTU WERDYKTÓW KOMA');
  zapisz(`Data: ${teraz.toLocaleString('pl-PL')}`);
  zapisz(`Tryb: ${URL_SERWERA ? `serwer ${URL_SERWERA}` : 'pipeline bezpośrednio'}`);
  zapisz(`Klucz do bazy fact-checkerów: ${process.env.GOOGLE_FACTCHECK_API_KEY ? 'tak' : 'NIE (oceny fact-checkerów wyłączone)'}`);
  zapisz(`Zapytań: ${doWykonania.length}`);
  zapisz('='.repeat(100));

  const wyniki = [];
  const start = Date.now();

  for (let i = 0; i < doWykonania.length; i++) {
    const z = doWykonania[i];
    const nr = `${String(i + 1).padStart(3, '0')}/${doWykonania.length}`;
    process.stdout.write(`[${nr}] ${skroc(z.tekst, 70)} ... `);

    const t0 = Date.now();
    let w = null;
    let blad = null;
    try {
      w = await sprawdz(z.tekst);
    } catch (e) {
      blad = e.message;
    }
    const sekundy = Math.round((Date.now() - t0) / 1000);
    const otrzymany = w?.werdykt_ogolny || w?.demagog?.werdykt_ogolny || (blad ? 'BŁĄD' : '?');
    const ok = otrzymany === z.oczekiwany;
    wyniki.push({ ...z, otrzymany, ok, sekundy, blad });
    console.log(`${ok ? 'OK ' : 'ŹLE'} ${otrzymany} (${sekundy} s)`);

    zapisz('');
    zapisz(`[${nr}] ${ok ? 'OK ' : 'ŹLE'} | Temat: ${z.temat} | Kategoria tematu: ${z.kategoria}`);
    zapisz(`  Zapytanie:   "${z.tekst}"`);
    zapisz(`  Oczekiwano:  ${z.oczekiwany}   (podstawa: ${z.zrodlo})`);
    zapisz(`  Otrzymano:   ${otrzymany}   | czas: ${sekundy} s`);
    if (blad) {
      zapisz(`  BŁĄD: ${blad}`);
      continue;
    }

    const m2 = new Map((w.model2?.claims || []).map((c) => [c.id, c]));
    const m3 = new Map((w.model3?.claims || []).map((c) => [c.claim_id, c]));
    zapisz('  Twierdzenia:');
    for (const t of w.demagog?.twierdzenia || []) {
      const c2 = m2.get(t.claim_id) || {};
      const c3 = m3.get(t.claim_id) || {};
      const dowody = c3.evidence || [];
      const fc = dowody.filter((e) => e.source_id === 'FACTCHECK');
      zapisz(`    - [${c2.type || c3.claim_type || '?'}] "${skroc(t.claim, 160)}"`);
      zapisz(`      werdykt: ${t.werdykt} | metoda: ${t.metoda || '?'} | wyszukiwanie: ${c3.search_status || '?'} | dowodów: ${dowody.length} (fact-check: ${fc.length})`);
      for (const e of fc) {
        zapisz(`      ocena fact-checkera: ${skroc((e.relevant_excerpts || [])[0], 220)}`);
      }
      zapisz(`      uzasadnienie: ${skroc(t.uzasadnienie, 500)}`);
      for (const zr of (t.uzyte_zrodla || []).slice(0, 3)) {
        zapisz(`      źródło: ${skroc(zr.title, 110)} | ${zr.url}`);
      }
      if (!(t.uzyte_zrodla || []).length && dowody.length) {
        zapisz(`      (przejrzane materiały: ${dowody.slice(0, 3).map((e) => skroc(e.title, 60)).join(' ; ')})`);
      }
    }
    const ostrz = w.metadane?.ostrzezenia || [];
    if (ostrz.length) zapisz(`  Ostrzeżenia: ${ostrz.join(' | ')}`);
  }

  // --- podsumowanie ---
  const WERDYKTY = ['Potwierdzone', 'Fałszywe', 'Wprowadzające w błąd', 'Brak wystarczających dowodów', 'Nie podlega weryfikacji'];
  const proc = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
  const trafione = wyniki.filter((w) => w.ok).length;

  zapisz('');
  zapisz('='.repeat(100));
  zapisz('PODSUMOWANIE');
  zapisz('='.repeat(100));
  zapisz(`Trafność ogółem: ${trafione}/${wyniki.length} (${proc(trafione, wyniki.length)})`);
  zapisz(`Błędy wykonania: ${wyniki.filter((w) => w.blad).length}`);
  zapisz(`Czas całkowity: ${Math.round((Date.now() - start) / 60000)} min, średnio ${Math.round(wyniki.reduce((s, w) => s + w.sekundy, 0) / Math.max(1, wyniki.length))} s na zapytanie`);

  zapisz('');
  zapisz('Trafność według oczekiwanego werdyktu:');
  for (const wd of WERDYKTY) {
    const grupa = wyniki.filter((w) => w.oczekiwany === wd);
    if (grupa.length) zapisz(`  ${wd.padEnd(30)} ${grupa.filter((w) => w.ok).length}/${grupa.length} (${proc(grupa.filter((w) => w.ok).length, grupa.length)})`);
  }

  zapisz('');
  zapisz('Macierz pomyłek (wiersz = oczekiwany, kolumna = otrzymany):');
  const skrot = { Potwierdzone: 'POTW', Fałszywe: 'FAŁSZ', 'Wprowadzające w błąd': 'WPROW', 'Brak wystarczających dowodów': 'BRAK', 'Nie podlega weryfikacji': 'NIE-POD', BŁĄD: 'BŁĄD' };
  const kolumny = [...WERDYKTY, 'BŁĄD'];
  zapisz('  ' + ''.padEnd(10) + kolumny.map((k) => skrot[k].padStart(9)).join(''));
  for (const wd of WERDYKTY) {
    const grupa = wyniki.filter((w) => w.oczekiwany === wd);
    if (!grupa.length) continue;
    zapisz('  ' + skrot[wd].padEnd(10) + kolumny.map((k) => String(grupa.filter((w) => w.otrzymany === k).length).padStart(9)).join(''));
  }

  zapisz('');
  zapisz('Spójność w tematach (czy różne sformułowania tego samego dostały ten sam werdykt):');
  for (const temat of [...new Set(wyniki.map((w) => w.temat))]) {
    const grupa = wyniki.filter((w) => w.temat === temat);
    const traf = grupa.filter((w) => w.ok).length;
    const rozne = [...new Set(grupa.map((w) => `${w.oczekiwany === grupa[0].kategoria ? '' : '(zaprzeczenie) '}${w.otrzymany}`))];
    zapisz(`  ${traf === grupa.length ? 'OK ' : '!! '} ${temat.padEnd(38)} ${traf}/${grupa.length} | otrzymane: ${rozne.join(', ')}`);
  }

  const zle = wyniki.filter((w) => !w.ok);
  if (zle.length) {
    zapisz('');
    zapisz('Lista pomyłek:');
    for (const w of zle) zapisz(`  - "${w.tekst}" -> ${w.otrzymany} (oczekiwano: ${w.oczekiwany})${w.blad ? ` [${w.blad}]` : ''}`);
  }

  console.log(`\nGotowe: ${trafione}/${wyniki.length} trafnych. Raport: ${plik}`);
  process.exit(0);
})();
