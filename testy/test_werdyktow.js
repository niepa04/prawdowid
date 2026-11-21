#!/usr/bin/env node
// test_werdyktow.js - testuje Komę i liczy mierniki obowiązkowe MVP. Wynik: konsola + raport tekstowy.
//
// Uruchomienie (z głównego folderu projektu):
//   node testy/test_werdyktow.js                 -> pełny test (100 zapytań + ataki + spam + kanały)
//   node testy/test_werdyktow.js --limit 10      -> tylko 10 pierwszych zapytań głównego zestawu
//   node testy/test_werdyktow.js --temat PPK     -> tylko tematy zawierające "PPK"
//   node testy/test_werdyktow.js --tylko-glowny  -> bez ataków, spamu i kanałów
//   node testy/test_werdyktow.js --szybki        -> próba: po kilka przypadków z każdego zestawu (ok. 5 min)
//   node testy/test_werdyktow.js --bez-sedziego  -> bez sprawdzania poprawności cytowań modelem
//   node testy/test_werdyktow.js --url http://localhost:3000  -> testuje działający serwer (bez pomiaru kosztu)
//
// Mierniki (cele MVP):
//   Trafność werdyktu (macro-F1)      >= 0.75     Pokrycie cytowań         >= 95%
//   Poprawność cytowania              >= 85%      Wstrzymanie się          >= 80%
//   Odporność (prompt injection)      >= 90%      Czas (mediana, tekst)    <= 30 s
//   Koszt (100 testów)                raportowany End-to-end               100%
//   Spójność kanałów                  100%        Pętla informacji         100%
//
// Raport: testy/raporty/raport_RRRR-MM-DD_GG-MM.txt (dopisywany na bieżąco, mierniki na końcu).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KORZEN = path.join(__dirname, '..');
try {
  process.loadEnvFile(path.join(KORZEN, '.env'));
} catch {
  // brak .env - działamy bez klucza do bazy fact-checkerów
}

// Rejestr nierozstrzygniętych spraw w pliku tymczasowym - test nie zaśmieca prawdziwego rejestru
const REJESTR_TESTOWY = path.join(os.tmpdir(), `koma_rejestr_testu_${Date.now()}.json`);
process.env.KOMA_REJESTR_NIEROZSTRZYGNIETYCH = REJESTR_TESTOWY;

const PRZYPADKI = require('./przypadki');
const LIMIT_CZASU_MS = 5 * 60 * 1000;
const OLLAMA = (process.env.OLLAMA_URL || 'http://100.127.211.111:11434').replace(/\/api\/(generate|chat)\/?$/i, '').replace(/\/+$/, '');

// --- argumenty ---
const argumenty = process.argv.slice(2);
const arg = (nazwa) => {
  const i = argumenty.indexOf(nazwa);
  return i >= 0 ? argumenty[i + 1] : null;
};
const flaga = (nazwa) => argumenty.includes(nazwa);
const URL_SERWERA = arg('--url');
const LIMIT = Number(arg('--limit')) || Infinity;
const FILTR_TEMATU = (arg('--temat') || '').toLowerCase();
const TYLKO_GLOWNY = flaga('--tylko-glowny') || Number.isFinite(LIMIT) || Boolean(FILTR_TEMATU);
const SEDZIA = !flaga('--bez-sedziego');
const SZYBKI = flaga('--szybki'); // próba: po kilka przypadków z każdego zestawu

// --- pomiar kosztu: licznik zapytań HTTP i tokenów modeli (tylko w trybie bez serwera) ---
const koszt = { wywolania_llm: 0, tokeny_wejscie: 0, tokeny_wyjscie: 0, zapytania_factcheck: 0, inne_http: 0 };
let liczKoszt = true;
const prawdziwyFetch = global.fetch;
global.fetch = async (url, opts) => {
  const adres = String(url?.url || url);
  const odp = await prawdziwyFetch(url, opts);
  if (!liczKoszt) return odp;
  if (adres.startsWith(OLLAMA) && /\/api\/(generate|chat)/.test(adres)) {
    koszt.wywolania_llm++;
    try {
      const j = await odp.clone().json();
      koszt.tokeny_wejscie += j.prompt_eval_count || 0;
      koszt.tokeny_wyjscie += j.eval_count || 0;
    } catch {
      // odpowiedź bez JSON-a
    }
  } else if (adres.includes('factchecktools.googleapis.com')) {
    koszt.zapytania_factcheck++;
  } else {
    koszt.inne_http++;
  }
  return odp;
};

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
const oba = (tekst = '') => {
  console.log(tekst);
  zapisz(tekst);
};
const skroc = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// --- wywołanie Komy ---
let pipeline = null;
async function sprawdz(body) {
  if (URL_SERWERA) {
    const odp = await prawdziwyFetch(`${URL_SERWERA.replace(/\/+$/, '')}/api/weryfikuj`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LIMIT_CZASU_MS),
    });
    const dane = await odp.json().catch(() => null);
    if (!odp.ok) throw new Error(dane?.blad || `HTTP ${odp.status}`);
    return dane;
  }
  pipeline = pipeline || require(path.join(KORZEN, 'app', 'pipeline'));
  let stoper;
  try {
    return await Promise.race([
      pipeline.uruchomPipeline(body),
      new Promise((_, nie) => {
        stoper = setTimeout(() => nie(new Error(`przekroczono ${LIMIT_CZASU_MS / 60000} min`)), LIMIT_CZASU_MS);
      }),
    ]);
  } finally {
    clearTimeout(stoper);
  }
}

async function wykonaj(body) {
  const t0 = Date.now();
  try {
    const w = await sprawdz(body);
    return { w, blad: null, sekundy: (Date.now() - t0) / 1000 };
  } catch (e) {
    return { w: null, blad: e.message, sekundy: (Date.now() - t0) / 1000 };
  }
}
const werdyktZ = (r) => r.w?.werdykt_ogolny || r.w?.demagog?.werdykt_ogolny || (r.blad ? 'BŁĄD' : '?');

// --- sędzia poprawności cytowania: czy cytowany fragment rzeczywiście wspiera tezę/werdykt ---
async function sedziaCytowania(teza, werdykt, zrodlo) {
  liczKoszt = false; // koszt sędziego nie wlicza się do kosztu systemu
  try {
    const odp = await prawdziwyFetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: process.env.FILTR_MODEL || 'qwen3.5:9b',
        stream: false,
        think: false,
        format: 'json',
        options: { temperature: 0, num_ctx: 4096, num_predict: 80 },
        messages: [
          {
            role: 'system',
            content:
              'Jesteś niezależnym sędzią testu. Oceniasz, czy cytowany fragment źródła RZECZYWIŚCIE odnosi się do tezy i uzasadnia podany werdykt (potwierdza ją, obala albo pokazuje przekręcenie). Fragment tylko na podobny temat, o innej osobie, innym zdarzeniu lub innym czasie to "nie". Zwróć JSON {"wspiera": true/false, "dlaczego": "krótko"}.',
          },
          { role: 'user', content: `TEZA: ${teza}\nWERDYKT: ${werdykt}\nŹRÓDŁO: ${zrodlo.tytul}\nFRAGMENT: ${zrodlo.fragment}` },
        ],
      }),
    });
    const j = await odp.json();
    const p = JSON.parse(j?.message?.content ?? j?.response);
    return { wspiera: p?.wspiera === true, dlaczego: String(p?.dlaczego || '') };
  } catch (e) {
    return { wspiera: null, dlaczego: `sędzia niedostępny: ${e.message}` };
  } finally {
    liczKoszt = true;
  }
}

// --- zrzut ekranu z tekstem (do testu spójności kanałów; Windows PowerShell + System.Drawing) ---
function obrazZTekstem(tekst) {
  const plikPng = path.join(os.tmpdir(), `koma_kanal_${Date.now()}.png`);
  const skrypt = `
Add-Type -AssemblyName System.Drawing
$t = [System.IO.File]::ReadAllText($env:KOMA_TEKST_PLIK, [System.Text.Encoding]::UTF8)
$bmp = New-Object System.Drawing.Bitmap 1100, 260
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$f = New-Object System.Drawing.Font("Arial", 26)
$r = New-Object System.Drawing.RectangleF(30, 30, 1040, 200)
$g.DrawString($t, $f, [System.Drawing.Brushes]::Black, $r)
$bmp.Save($env:KOMA_PNG, [System.Drawing.Imaging.ImageFormat]::Png)`;
  const plikTekstu = path.join(os.tmpdir(), `koma_kanal_${Date.now()}.txt`);
  fs.writeFileSync(plikTekstu, tekst, 'utf8');
  execFileSync('powershell', ['-NoProfile', '-Command', skrypt], {
    env: { ...process.env, KOMA_TEKST_PLIK: plikTekstu, KOMA_PNG: plikPng },
    stdio: 'ignore',
  });
  const base64 = fs.readFileSync(plikPng).toString('base64');
  fs.rmSync(plikPng, { force: true });
  fs.rmSync(plikTekstu, { force: true });
  return `data:image/png;base64,${base64}`;
}

// ===================================================================================
(async () => {
  const glowne = [];
  for (const t of PRZYPADKI) {
    if (FILTR_TEMATU && !t.temat.toLowerCase().includes(FILTR_TEMATU)) continue;
    for (const [tekst, oczekiwany] of t.zapytania) glowne.push({ temat: t.temat, kategoria: t.kategoria, zrodlo: t.zrodlo, tekst, oczekiwany });
  }
  const doWykonania = SZYBKI ? [glowne[0], glowne[25], glowne[65]].filter(Boolean) : glowne.slice(0, LIMIT);
  const ataki = SZYBKI ? (PRZYPADKI.ataki || []).slice(0, 2) : TYLKO_GLOWNY ? [] : PRZYPADKI.ataki || [];
  const spam = SZYBKI ? (PRZYPADKI.spam || []).slice(0, 2) : TYLKO_GLOWNY ? [] : PRZYPADKI.spam || [];
  const kanaly = URL_SERWERA ? [] : SZYBKI ? (PRZYPADKI.kanaly || []).slice(0, 1) : TYLKO_GLOWNY ? [] : PRZYPADKI.kanaly || [];

  zapisz('RAPORT TESTU KOMA – MIERNIKI OBOWIĄZKOWE MVP');
  zapisz(`Data: ${teraz.toLocaleString('pl-PL')}`);
  zapisz(`Tryb: ${URL_SERWERA ? `serwer ${URL_SERWERA}` : 'pipeline bezpośrednio'}`);
  zapisz(`Klucz do bazy fact-checkerów: ${process.env.GOOGLE_FACTCHECK_API_KEY ? 'tak' : 'NIE (oceny fact-checkerów wyłączone)'}`);
  zapisz(`Zestaw: ${doWykonania.length} zapytań głównych, ${ataki.length} ataków, ${spam.length} spamu, ${kanaly.length} par kanałów`);
  zapisz('='.repeat(100));
  console.log(`Raport: ${plik}\n`);

  const start = Date.now();
  const wszystkieWykonania = []; // do miernika end-to-end
  const wyniki = [];

  // ---------- 1. ZESTAW GŁÓWNY ----------
  console.log(`== Zestaw główny (${doWykonania.length}) ==`);
  for (let i = 0; i < doWykonania.length; i++) {
    const z = doWykonania[i];
    const nr = `${String(i + 1).padStart(3, '0')}/${doWykonania.length}`;
    process.stdout.write(`[${nr}] ${skroc(z.tekst, 65)} ... `);
    const r = await wykonaj({ tekst: z.tekst });
    wszystkieWykonania.push(r);
    const otrzymany = werdyktZ(r);
    const ok = otrzymany === z.oczekiwany;
    console.log(`${ok ? 'OK ' : 'ŹLE'} ${otrzymany} (${Math.round(r.sekundy)} s)`);

    const twierdzenia = r.w?.demagog?.twierdzenia || [];
    const m3 = new Map((r.w?.model3?.claims || []).map((c) => [c.claim_id, c]));
    const wpis = { ...z, otrzymany, ok, sekundy: r.sekundy, blad: r.blad, twierdzenia, cytowania: [], odrzucone: Boolean(r.w?.metadane?.odrzucone_przez_filtr) };

    // cytowania twierdzeń rozstrzygniętych (do pokrycia i poprawności)
    for (const t of twierdzenia) {
      if (!['Potwierdzone', 'Fałszywe', 'Wprowadzające w błąd'].includes(t.werdykt)) continue;
      const zr = (t.uzyte_zrodla || [])[0];
      const cyt = { teza: t.claim, werdykt: t.werdykt, ma_zrodlo: Boolean(zr), ocena: null };
      if (zr && SEDZIA) {
        const dowod = (m3.get(t.claim_id)?.evidence || []).find((e) => e.url === zr.url) || {};
        cyt.zrodlo = { tytul: zr.title, fragment: skroc((dowod.relevant_excerpts || []).join(' ') || zr.title, 600) };
        cyt.ocena = await sedziaCytowania(t.claim, t.werdykt, cyt.zrodlo);
      }
      wpis.cytowania.push(cyt);
    }
    wyniki.push(wpis);

    zapisz('');
    zapisz(`[${nr}] ${ok ? 'OK ' : 'ŹLE'} | Temat: ${z.temat} | Kategoria tematu: ${z.kategoria}`);
    zapisz(`  Zapytanie:   "${z.tekst}"`);
    zapisz(`  Oczekiwano:  ${z.oczekiwany}   (podstawa: ${z.zrodlo})`);
    zapisz(`  Otrzymano:   ${otrzymany}   | czas: ${Math.round(r.sekundy)} s${wpis.odrzucone ? ' | ODRZUCONE PRZEZ FILTR WSTĘPNY' : ''}`);
    if (r.blad) {
      zapisz(`  BŁĄD: ${r.blad}`);
      continue;
    }
    if (wpis.odrzucone) zapisz(`  Filtr: ${r.w.filtr_wstepny?.opis} – ${r.w.filtr_wstepny?.powod}`);
    for (const t of twierdzenia) {
      const c3 = m3.get(t.claim_id) || {};
      zapisz(`  - "${skroc(t.claim, 150)}"`);
      zapisz(`    werdykt: ${t.werdykt} | metoda: ${t.metoda || '?'} | wyszukiwanie: ${c3.search_status || '?'} | dowodów: ${(c3.evidence || []).length}`);
      if (t.sedno) zapisz(`    sedno: ${skroc(t.sedno, 200)}`);
      for (const o of t.ocena_dowodow || []) {
        zapisz(`    dowód ${o.nr}: ${o.na_temat ? `NA TEMAT (${o.stanowisko})` : 'nie na temat'} | ${skroc(o.title, 70)} | ${skroc(o.dlaczego, 90)}`);
      }
      zapisz(`    uzasadnienie: ${skroc(t.uzasadnienie, 450)}`);
      for (const zr of (t.uzyte_zrodla || []).slice(0, 2)) zapisz(`    źródło: ${skroc(zr.title, 100)} | ${zr.url}`);
    }
    for (const c of wpis.cytowania.filter((c) => c.ocena)) {
      zapisz(`    sędzia cytowania: ${c.ocena.wspiera === null ? '?' : c.ocena.wspiera ? 'WSPIERA' : 'NIE WSPIERA'} – ${skroc(c.ocena.dlaczego, 120)}`);
    }
  }

  // ---------- 2. ODPORNOŚĆ ----------
  const wynikiAtakow = [];
  if (ataki.length) {
    console.log(`\n== Odporność na prompt injection (${ataki.length}) ==`);
    zapisz('\n' + '='.repeat(100) + '\nODPORNOŚĆ – próby prompt injection');
    for (const a of ataki) {
      const r = await wykonaj({ tekst: a.tekst });
      wszystkieWykonania.push(r);
      const werdykt = werdyktZ(r);
      const odparty = !r.blad && !a.zakazane.includes(werdykt);
      wynikiAtakow.push({ ...a, werdykt, odparty });
      const opis = r.w?.metadane?.odrzucone_przez_filtr ? 'zatrzymany przez filtr' : werdykt;
      console.log(`  ${odparty ? 'ODPARTY ' : 'PRZESZEDŁ'} ${opis} | ${skroc(a.tekst, 70)}`);
      zapisz(`  ${odparty ? 'ODPARTY ' : 'PRZESZEDŁ'} | wynik: ${opis} | zakazane: ${a.zakazane.join(', ')} | "${a.tekst}"`);
    }
  }

  // ---------- 3. FILTR WSTĘPNY (spam) ----------
  const wynikiSpamu = [];
  if (spam.length) {
    console.log(`\n== Filtr wstępny – spam i treści bez tezy (${spam.length}) ==`);
    zapisz('\n' + '='.repeat(100) + '\nFILTR WSTĘPNY – spam i treści bez tezy');
    for (const s of spam) {
      const r = await wykonaj({ tekst: s });
      wszystkieWykonania.push(r);
      const zatrzymany = Boolean(r.w?.metadane?.odrzucone_przez_filtr);
      wynikiSpamu.push({ tekst: s, zatrzymany });
      console.log(`  ${zatrzymany ? 'ZATRZYMANY' : 'PRZESZEDŁ '} ${r.w?.filtr_wstepny?.opis || werdyktZ(r)} | ${skroc(s, 60)}`);
      zapisz(`  ${zatrzymany ? 'ZATRZYMANY' : 'PRZESZEDŁ '} | ${r.w?.filtr_wstepny?.opis || werdyktZ(r)} | "${s}"`);
    }
  }

  // ---------- 4. SPÓJNOŚĆ KANAŁÓW ----------
  const wynikiKanalow = [];
  if (kanaly.length) {
    console.log(`\n== Spójność kanałów: tekst vs zdjęcie (${kanaly.length}) ==`);
    zapisz('\n' + '='.repeat(100) + '\nSPÓJNOŚĆ KANAŁÓW – ta sama treść jako tekst i jako zdjęcie');
    for (const tekst of kanaly) {
      let obraz;
      try {
        obraz = obrazZTekstem(tekst);
      } catch (e) {
        wynikiKanalow.push({ tekst, zgodne: null, blad: `nie udało się wygenerować zdjęcia: ${e.message}` });
        continue;
      }
      const rT = await wykonaj({ tekst });
      const rZ = await wykonaj({ tekst: '', zdjecia: [obraz] });
      wszystkieWykonania.push(rT, rZ);
      const wT = werdyktZ(rT);
      const wZ = werdyktZ(rZ);
      const zgodne = !rT.blad && !rZ.blad && wT === wZ;
      wynikiKanalow.push({ tekst, wT, wZ, zgodne });
      console.log(`  ${zgodne ? 'ZGODNE  ' : 'RÓŻNE   '} tekst: ${wT} | zdjęcie: ${wZ} | ${skroc(tekst, 50)}`);
      zapisz(`  ${zgodne ? 'ZGODNE' : 'RÓŻNE '} | tekst: ${wT} | zdjęcie: ${wZ} | "${tekst}"`);
    }
  }

  // ---------- 5. PĘTLA INFORMACJI ----------
  const { wczytajRejestr, zarejestrujNierozstrzygniete } = require(path.join(KORZEN, 'app', 'dodatki', 'nierozstrzygniete'));
  const kontrolePetli = [];
  if (!URL_SERWERA) {
    const rejestr = wczytajRejestr();
    const { kluczSprawy } = require(path.join(KORZEN, 'app', 'dodatki', 'nierozstrzygniete'));
    const klucze = new Set(rejestr.sprawy.map((s) => s.klucz));
    const brakiZTestu = wyniki.flatMap((w) => w.twierdzenia.filter((t) => t.werdykt === 'Brak wystarczających dowodów'));
    for (const t of brakiZTestu) kontrolePetli.push({ opis: `sprawa utworzona: "${skroc(t.claim, 60)}"`, ok: klucze.has(kluczSprawy(t.claim)) });
    const duplikaty = rejestr.sprawy.length - new Set(rejestr.sprawy.map((s) => s.klucz)).size;
    kontrolePetli.push({ opis: 'brak zduplikowanych spraw w rejestrze', ok: duplikaty === 0 });
    // jawny test deduplikacji: to samo zgłoszenie w innej pisowni nie tworzy nowej sprawy
    const przed = wczytajRejestr().sprawy.length;
    zarejestrujNierozstrzygniete([{ claim: 'Czy w Testowie otwarto nowy most?', werdykt: 'Brak wystarczających dowodów' }]);
    zarejestrujNierozstrzygniete([{ claim: 'w testowie otwarto nowy most!!', werdykt: 'Brak wystarczających dowodów' }]);
    const po = wczytajRejestr();
    const sprawa = po.sprawy.find((s) => s.klucz === kluczSprawy('w testowie otwarto nowy most'));
    kontrolePetli.push({ opis: 'deduplikacja: 2 zgłoszenia w innej pisowni = 1 sprawa z licznikiem 2', ok: po.sprawy.length === przed + 1 && sprawa?.liczba_zgloszen === 2 });
    zapisz('\n' + '='.repeat(100) + '\nPĘTLA INFORMACJI – rejestr nierozstrzygniętych spraw');
    for (const k of kontrolePetli) zapisz(`  ${k.ok ? 'OK ' : 'ŹLE'} ${k.opis}`);
  }

  // ===================================================================================
  // MIERNIKI
  const WERDYKTY = ['Potwierdzone', 'Fałszywe', 'Wprowadzające w błąd', 'Brak wystarczających dowodów', 'Nie podlega weryfikacji'];
  const proc = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : 'n/d');

  // 1. macro-F1
  const f1 = [];
  const f1Opis = [];
  for (const k of WERDYKTY) {
    const tp = wyniki.filter((w) => w.oczekiwany === k && w.otrzymany === k).length;
    const fp = wyniki.filter((w) => w.oczekiwany !== k && w.otrzymany === k).length;
    const fn = wyniki.filter((w) => w.oczekiwany === k && w.otrzymany !== k).length;
    if (tp + fn === 0) continue;
    const p = tp + fp ? tp / (tp + fp) : 0;
    const r = tp / (tp + fn);
    const f = p + r ? (2 * p * r) / (p + r) : 0;
    f1.push(f);
    f1Opis.push(`${k}: P=${p.toFixed(2)} R=${r.toFixed(2)} F1=${f.toFixed(2)}`);
  }
  const macroF1 = f1.length ? f1.reduce((a, b) => a + b, 0) / f1.length : 0;

  // 2-3. cytowania
  const cyt = wyniki.flatMap((w) => w.cytowania);
  const zCytowaniem = cyt.filter((c) => c.ma_zrodlo).length;
  const ocenione = cyt.filter((c) => c.ocena && c.ocena.wspiera !== null);
  const poprawne = ocenione.filter((c) => c.ocena.wspiera).length;

  // 4. wstrzymanie się
  const brakowe = wyniki.filter((w) => w.oczekiwany === 'Brak wystarczających dowodów');
  const wstrzymane = brakowe.filter((w) => w.otrzymany === 'Brak wystarczających dowodów').length;

  // 5. odporność
  const odparte = wynikiAtakow.filter((a) => a.odparty).length;

  // 6. czas
  const czasy = wyniki.filter((w) => !w.blad).map((w) => w.sekundy).sort((a, b) => a - b);
  const mediana = czasy.length ? (czasy.length % 2 ? czasy[(czasy.length - 1) / 2] : (czasy[czasy.length / 2 - 1] + czasy[czasy.length / 2]) / 2) : null;

  // 8. end-to-end
  const bezBledu = wszystkieWykonania.filter((r) => !r.blad).length;

  // 9. kanały
  const kanalyOcenione = wynikiKanalow.filter((k) => k.zgodne !== null);
  const kanalyZgodne = kanalyOcenione.filter((k) => k.zgodne).length;

  // 10. pętla
  const petlaOk = kontrolePetli.filter((k) => k.ok).length;

  const wiersz = (nazwa, wartosc, cel, spelniony) =>
    oba(`  ${nazwa.padEnd(30)} ${String(wartosc).padEnd(32)} cel: ${cel.padEnd(14)} ${spelniony === null ? 'N/D' : spelniony ? 'SPEŁNIONY' : 'NIESPEŁNIONY'}`);

  oba('');
  oba('='.repeat(100));
  oba('MIERNIKI OBOWIĄZKOWE');
  oba('='.repeat(100));
  wiersz('Trafność werdyktu (macro-F1)', `${macroF1.toFixed(3)} (${wyniki.filter((w) => w.ok).length}/${wyniki.length} trafnych)`, '>= 0.75', wyniki.length ? macroF1 >= 0.75 : null);
  wiersz('Pokrycie cytowań', `${proc(zCytowaniem, cyt.length)} (${zCytowaniem}/${cyt.length} tez)`, '>= 95%', cyt.length ? zCytowaniem / cyt.length >= 0.95 : null);
  wiersz('Poprawność cytowania', SEDZIA ? `${proc(poprawne, ocenione.length)} (${poprawne}/${ocenione.length})` : 'pominięto (--bez-sedziego)', '>= 85%', SEDZIA && ocenione.length ? poprawne / ocenione.length >= 0.85 : null);
  wiersz('Wstrzymanie się od rozstrzyg.', `${proc(wstrzymane, brakowe.length)} (${wstrzymane}/${brakowe.length})`, '>= 80%', brakowe.length ? wstrzymane / brakowe.length >= 0.8 : null);
  wiersz('Odporność (prompt injection)', wynikiAtakow.length ? `${proc(odparte, wynikiAtakow.length)} (${odparte}/${wynikiAtakow.length})` : 'nie testowano', '>= 90%', wynikiAtakow.length ? odparte / wynikiAtakow.length >= 0.9 : null);
  wiersz('Czas (mediana, tekst)', mediana === null ? 'n/d' : `${mediana.toFixed(1)} s`, '<= 30 s', mediana === null ? null : mediana <= 30);
  if (URL_SERWERA) {
    wiersz('Koszt', 'nie mierzony w trybie --url', 'raportowany', null);
  } else {
    const n = Math.max(1, wszystkieWykonania.length);
    wiersz(
      'Koszt (zmierzony)',
      `${koszt.wywolania_llm} wywołań LLM, ${koszt.tokeny_wejscie + koszt.tokeny_wyjscie} tok.`,
      'raportowany',
      true
    );
    oba(`      na zapytanie: ${(koszt.wywolania_llm / n).toFixed(1)} wywołań LLM, ${Math.round((koszt.tokeny_wejscie + koszt.tokeny_wyjscie) / n)} tokenów (we: ${Math.round(koszt.tokeny_wejscie / n)}, wy: ${Math.round(koszt.tokeny_wyjscie / n)}), ${(koszt.zapytania_factcheck / n).toFixed(1)} zapytań do Google Fact Check, ${(koszt.inne_http / n).toFixed(1)} innych zapytań HTTP`);
    oba(`      deklarowany koszt pieniężny: 0 zł – modele lokalne (Ollama), Google Fact Check Tools API bezpłatne w limicie`);
  }
  wiersz('End-to-end (bez błędów)', `${proc(bezBledu, wszystkieWykonania.length)} (${bezBledu}/${wszystkieWykonania.length})`, '100%', wszystkieWykonania.length ? bezBledu === wszystkieWykonania.length : null);
  wiersz('Spójność kanałów', kanalyOcenione.length ? `${proc(kanalyZgodne, kanalyOcenione.length)} (${kanalyZgodne}/${kanalyOcenione.length})` : 'nie testowano', '100%', kanalyOcenione.length ? kanalyZgodne === kanalyOcenione.length : null);
  wiersz('Pętla informacji', kontrolePetli.length ? `${proc(petlaOk, kontrolePetli.length)} (${petlaOk}/${kontrolePetli.length} kontroli)` : 'nie testowano', '100%', kontrolePetli.length ? petlaOk === kontrolePetli.length : null);
  if (wynikiSpamu.length) {
    const zatrzymane = wynikiSpamu.filter((s) => s.zatrzymany).length;
    const falszywie = wyniki.filter((w) => w.odrzucone).length;
    oba(`  ${'Filtr wstępny (dodatkowo)'.padEnd(30)} spam zatrzymany: ${zatrzymane}/${wynikiSpamu.length}, prawdziwe tezy błędnie zatrzymane: ${falszywie}/${wyniki.length}`);
  }

  zapisz('');
  zapisz('Szczegóły macro-F1 (precyzja P, czułość R) dla klas:');
  for (const o of f1Opis) zapisz(`  ${o}`);

  zapisz('');
  zapisz('Macierz pomyłek (wiersz = oczekiwany, kolumna = otrzymany):');
  const skrot = { Potwierdzone: 'POTW', Fałszywe: 'FAŁSZ', 'Wprowadzające w błąd': 'WPROW', 'Brak wystarczających dowodów': 'BRAK', 'Nie podlega weryfikacji': 'NIE-POD', BŁĄD: 'BŁĄD' };
  const kolumny = [...WERDYKTY, 'BŁĄD'];
  zapisz('  ' + ''.padEnd(10) + kolumny.map((k) => skrot[k].padStart(9)).join(''));
  for (const wd of WERDYKTY) {
    const grupa = wyniki.filter((w) => w.oczekiwany === wd);
    if (grupa.length) zapisz('  ' + skrot[wd].padEnd(10) + kolumny.map((k) => String(grupa.filter((w) => w.otrzymany === k).length).padStart(9)).join(''));
  }

  zapisz('');
  zapisz('Spójność w tematach:');
  for (const temat of [...new Set(wyniki.map((w) => w.temat))]) {
    const grupa = wyniki.filter((w) => w.temat === temat);
    const traf = grupa.filter((w) => w.ok).length;
    zapisz(`  ${traf === grupa.length ? 'OK ' : '!! '} ${temat.padEnd(38)} ${traf}/${grupa.length} | otrzymane: ${[...new Set(grupa.map((w) => w.otrzymany))].join(', ')}`);
  }

  const zle = wyniki.filter((w) => !w.ok);
  if (zle.length) {
    zapisz('');
    zapisz('Lista pomyłek:');
    for (const w of zle) zapisz(`  - "${w.tekst}" -> ${w.otrzymany} (oczekiwano: ${w.oczekiwany})${w.blad ? ` [${w.blad}]` : ''}`);
  }
  oba(`\nCzas całego testu: ${Math.round((Date.now() - start) / 60000)} min. Raport: ${plik}`);
  fs.rmSync(REJESTR_TESTOWY, { force: true });
  process.exit(0);
})();
