const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { utworzMonitoring, ocenNadaktywnosc, sprawdzNadaktywnosc } = require('./index');
const { graniceCzasowe, wyciagnijTrescDoMonitoringu } = require('./normalizacja');
const { uruchomPipeline } = require('../pipeline');
const { utworzSerwer } = require('../serwer');

function tempDbPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-mon-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // pomijamy na Windows przy opóźnionym zwolnieniu uchwytu
    }
  });
  return path.join(dir, 'monitoring.sqlite');
}

function mockOllama(handler) {
  let licznik = 0;
  const mockFetch = async (url, init) => {
    licznik++;
    const body = JSON.parse(init.body);
    const wynik = await handler(body, licznik, url);
    return {
      ok: true,
      json: async () => ({ done: true, message: { content: JSON.stringify(wynik) } }),
    };
  };
  mockFetch.liczbaWywolan = () => licznik;
  return mockFetch;
}

test('Normalizacja: wyodrębnia [TEKST] bez treści linków i poprawnie liczy granice dnia', () => {
  const wyciag = wyciagnijTrescDoMonitoringu(
    '===== [TEKST] =====\nCzy nad Polską przelatują rosyjskie samoloty?\n\n===== [LINKI] =====\nBardzo długi tekst artykułu...'
  );
  assert.equal(wyciag.tekstOczyszczony, 'Czy nad Polską przelatują rosyjskie samoloty?');
  assert.equal(wyciag.zrodloWejscia, 'mieszane');

  const g = graniceCzasowe(new Date('2026-11-22T01:30:00Z'), 'Europe/Warsaw');
  assert.equal(g.dataDnia, '2026-11-22');
  assert.equal(g.poczatekDniaIso, '2026-11-21T23:00:00.000Z');
});

test('Grupowanie semantyczne (qwen3.5:9b): różne sformułowania o rosyjskich samolotach trafiają do jednego klastra, a inny temat osobno', async (t) => {
  const fetchMock = mockOllama((body) => {
    const userMsg = body.messages[1].content;
    const m = /<ZGLOSZENIE>\s*([\s\S]*?)\s*<\/ZGLOSZENIE>/.exec(userMsg);
    const zgloszenie = m ? m[1] : userMsg;
    if (/rosyjskie|loty|samoloty/i.test(zgloszenie)) {
      if (/"id":1/.test(userMsg)) {
        return {
          decyzja: 'istniejacy',
          klaster_id: 1,
          pewnosc: 0.96,
          nowy_klaster: null,
          uzasadnienie: 'Oba pytania dotyczą przelotów rosyjskich samolotów nad Polską.',
        };
      }
      return {
        decyzja: 'nowy',
        klaster_id: null,
        pewnosc: 0.98,
        nowy_klaster: {
          tytul: 'Loty rosyjskich samolotów nad Polską',
          kanoniczne_pytanie: 'Czy nad Polską przelatują lub planowane są loty rosyjskich samolotów?',
          kategoria: 'bezpieczenstwo_militarne',
          slowa_kluczowe: ['rosyjskie', 'samoloty', 'polska', 'loty', 'niebo'],
        },
        uzasadnienie: 'Nowy temat dotyczący przestrzeni powietrznej.',
      };
    }
    return {
      decyzja: 'nowy',
      klaster_id: null,
      pewnosc: 0.95,
      nowy_klaster: {
        tytul: 'Darmowa komunikacja miejska we Wrocławiu',
        kanoniczne_pytanie: 'Czy we Wrocławiu komunikacja dla 65-latków jest darmowa?',
        kategoria: 'infrastruktura_transport',
        slowa_kluczowe: ['wroclaw', 'komunikacja', 'darmowa', 'seniorzy'],
      },
      uzasadnienie: 'Niezwiązany temat transportu miejskiego.',
    };
  });

  const mon = utworzMonitoring({
    sciezkaDb: tempDbPath(t),
    fetchImpl: fetchMock,
    cichyLog: true,
  });
  t.after(() => mon.zamknij());

  mon.zglosPrompt({ tekst: 'czy nad polska przelatuja rosyjskie samoloty' });
  mon.zglosPrompt({ tekst: 'czy dzisiaj planowane były loty rosyjskie w polskim niebie' });
  // Dokładny duplikat po normalizacji (powinien trafić po hashu bez wywołania modelu!)
  mon.zglosPrompt({ tekst: 'Czy nad Polską przelatują rosyjskie samoloty?!' });
  mon.zglosPrompt({ tekst: 'Czy we Wrocławiu komunikacja dla 65-latków jest darmowa?' });

  await mon.przetworzWszystkoTeraz({ wymusPodsumowanie: false });

  const panel = mon.pobierzPanel();
  assert.equal(panel.podsumowanie.zgloszenia_lacznie, 4);
  assert.equal(panel.podsumowanie.liczba_klastrow, 2);

  // Tylko 3 wywołania LLM (trzeci prompt miał dopasowanie O(1) po hashu)
  assert.equal(fetchMock.liczbaWywolan(), 3);

  const klasterSamoloty = panel.klastry.find((k) => /rosyjskich samolotów/i.test(k.tytul));
  assert.ok(klasterSamoloty);
  assert.equal(klasterSamoloty.liczba_zgloszen, 3);

  const szczegoly = mon.pobierzSzczegoly(klasterSamoloty.id);
  assert.equal(szczegoly.warianty.length, 2); // 2 unikalne sformułowania: 2x pierwsze + 1x drugie
});

test('Tryb awaryjny bez Ollamy: heurystyka bezpiecznie grupuje podobne pytania i nie zatrzymuje kolejki', async (t) => {
  const fetchPadl = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  };

  const mon = utworzMonitoring({
    sciezkaDb: tempDbPath(t),
    fetchImpl: fetchPadl,
    proby: 1,
    cichyLog: true,
  });
  t.after(() => mon.zamknij());

  mon.zglosPrompt({ tekst: 'czy nad polska przelatuja rosyjskie samoloty' });
  mon.zglosPrompt({ tekst: 'rosyjskie mysliwce w polskim niebie dzisiaj' });
  mon.zglosPrompt({ tekst: 'nowe zasady odbioru paszportu w urzedzie' });

  await mon.przetworzWszystkoTeraz({ wymusPodsumowanie: false });

  const panel = mon.pobierzPanel();
  assert.equal(panel.podsumowanie.zgloszenia_lacznie, 3);
  assert.equal(panel.podsumowanie.liczba_klastrow, 2);
});

test('Wykrywanie nadaktywności (522 zgłoszeń) i antydezinformacyjne podsumowanie dla rządu/użytkowników', async (t) => {
  const fetchMock = mockOllama((body) => {
    const sys = body.messages[0].content;
    if (sys.includes('analitykiem systemu wczesnego ostrzegania')) {
      return {
        podsumowanie_sytuacyjne:
          'Dzisiaj 522 użytkowników zapytało o rzekome przeloty rosyjskich samolotów nad Polską. W pytaniach wyraźnie widać obawę przed nalotami, jednak większość sprawdzonych twierdzeń okazała się fałszywa lub niepotwierdzona w źródłach MON/RCB.',
        obawy_spoleczne: ['obawa przed nalotami', 'niepewność o przestrzeń powietrzną'],
        rekomendacja_komunikacyjna: 'Zalecane opublikowanie jednoznacznego komunikatu DORSZ/RCB o sytuacji w przestrzeni powietrznej.',
        ocena_ryzyka_dezinformacji: 'niskie', // celowo zaniżone przez model - kod musi utrzymać "wysokie" z twardych danych!
      };
    }
    return {
      decyzja: 'nowy',
      klaster_id: null,
      pewnosc: 0.99,
      nowy_klaster: {
        tytul: 'Loty rosyjskich samolotów nad Polską',
        kanoniczne_pytanie: 'Czy nad Polską przelatują rosyjskie samoloty?',
        kategoria: 'bezpieczenstwo_militarne',
        slowa_kluczowe: ['rosyjskie', 'samoloty', 'naloty', 'polska'],
      },
    };
  });

  const mon = utworzMonitoring({
    sciezkaDb: tempDbPath(t),
    fetchImpl: fetchMock,
    cichyLog: true,
  });
  t.after(() => mon.zamknij());

  const teraz = new Date('2026-11-22T12:00:00Z');
  // Pierwszy prompt zakłada klaster przez model
  const pierwszy = mon.zglosPrompt({ tekst: 'czy nad polska przelatuja rosyjskie samoloty', teraz });
  await mon.przetworzWszystkoTeraz({ wymusPodsumowanie: false, teraz });
  mon.aktualizujWynik(pierwszy.zewnetrzneId, { statusWeryfikacji: 'zakonczona', werdyktOgolny: 'Fałszywe' });

  const klasterId = mon.pobierzPanel({ teraz }).klastry[0].id;

  // Masowe 521 kolejnych zgłoszeń (warianty dokładne + inne sformułowanie) w bazie
  mon.baza.db.exec('BEGIN IMMEDIATE');
  for (let i = 0; i < 310; i++) {
    const r = mon.baza.zapiszPrompt({
      zewnetrzneId: `u-a-${i}`,
      tekstOczyszczony: 'czy nad polska przelatuja rosyjskie samoloty',
      statusWeryfikacji: 'zakonczona',
      teraz,
    });
    mon.baza.przypiszDoIstniejacegoKlastra(r.id, klasterId, { pewnosc: 1, metoda: 'dokladny_hash', teraz });
    mon.baza.aktualizujWerdykt(`u-a-${i}`, { werdyktOgolny: 'Fałszywe' });
  }
  for (let i = 0; i < 211; i++) {
    const r = mon.baza.zapiszPrompt({
      zewnetrzneId: `u-b-${i}`,
      tekstOczyszczony: 'czy dzisiaj planowane były loty rosyjskie w polskim niebie',
      statusWeryfikacji: 'zakonczona',
      teraz,
    });
    mon.baza.przypiszDoIstniejacegoKlastra(r.id, klasterId, { pewnosc: 0.94, metoda: 'model_llm', teraz });
    mon.baza.aktualizujWerdykt(`u-b-${i}`, { werdyktOgolny: 'Brak wystarczających dowodów' });
  }
  mon.baza.db.exec('COMMIT');

  const alerty = await sprawdzNadaktywnosc(mon.baza, { fetchImpl: fetchMock, teraz, wymusPodsumowanie: true });
  assert.equal(alerty.length, 1);
  const a = alerty[0];
  assert.equal(a.poziom, 'krytyczna');
  assert.equal(a.liczba_dzis, 522);
  assert.equal(a.liczba_godzina, 522);
  assert.match(a.naglowek_alertu, /522 dzisiaj/);
  assert.match(a.podsumowanie_sytuacyjne, /obawę przed nalotami/i);
  assert.ok(a.obawy_spoleczne.includes('obawa przed nalotami'));
  // Twarda ochrona antydezinformacyjna: przewaga werdyktów Fałszywe nie pozwala zaniżyć ryzyka do "niskie"
  assert.equal(a.ocena_ryzyka_dezinformacji, 'wysokie');
  assert.equal(a.rozklad_werdyktow['Fałszywe'], 311);
  assert.equal(a.rozklad_werdyktow['Brak wystarczających dowodów'], 211);
});

test('Pipeline nie czeka na grupowanie w tle (zero opóźnienia dla użytkownika) i nie zapisuje danych osobowych ani spamu', async (t) => {
  // Symulujemy bardzo wolny serwer modelu dla grupowania w tle (1500 ms)
  const wolnyFetch = async () => {
    await new Promise((r) => setTimeout(r, 1500));
    return {
      ok: true,
      json: async () => ({
        done: true,
        message: {
          content: JSON.stringify({
            decyzja: 'nowy',
            klaster_id: null,
            pewnosc: 0.9,
            nowy_klaster: {
              tytul: 'Loty rosyjskich samolotów nad Polską',
              kanoniczne_pytanie: 'Czy nad Polską przelatują rosyjskie samoloty?',
              kategoria: 'bezpieczenstwo_militarne',
              slowa_kluczowe: ['rosyjskie', 'samoloty', 'polska'],
            },
          }),
        },
      }),
    };
  };

  const mon = utworzMonitoring({
    sciezkaDb: tempDbPath(t),
    fetchImpl: wolnyFetch,
    maxUstapienieMs: 0,
    cichyLog: true,
  });
  t.after(() => mon.zamknij());

  const start = Date.now();
  const wynik = await uruchomPipeline(
    { tekst: 'Czy nad Polską przelatują rosyjskie samoloty?' },
    {
      model1Impl: async (d) => d.tekst,
      filtrImpl: async () => ({ przepuscic: true, kategoria: 'teza', opis: 'teza do sprawdzenia', powod: '' }),
      researchImpl: async () => ({
        plan: { temat: 'Loty rosyjskich samolotów', pytania_badawcze: [] },
        materialy: [{ nr: 1, tytul: 'Komunikat MON', wydawca: 'gov.pl', url: 'https://www.gov.pl/1', fragmenty: [] }],
        notatka: { streszczenie: 'Brak doniesień.' },
        ostrzezenia: [],
        status: 'completed',
        czas_ms: 5,
      }),
      weryfikatorImpl: async () => ({
        werdykt_ogolny: 'Brak wystarczających dowodów',
        twierdzenia: [{ claim_id: 't1', claim: 'Czy nad Polską przelatują rosyjskie samoloty?', werdykt: 'Brak wystarczających dowodów', uzyte_zrodla: [] }],
        czas_ms: 5,
      }),
      rejestrImpl: null,
      monitoringImpl: mon,
    }
  );
  const czasOdpowiedzi = Date.now() - start;

  assert.equal(wynik.werdykt_ogolny, 'Brak wystarczających dowodów');
  // Odpowiedź wróciła natychmiast (< 400 ms), mimo że model grupowania w tle zajmuje 1500 ms!
  assert.ok(czasOdpowiedzi < 400, `Odpowiedź trwała ${czasOdpowiedzi}ms – nie powinna czekać na model tła!`);

  // Zgłoszenie z PESEL-em oraz spam NIE mogą trafić do bazy monitoringu
  await uruchomPipeline(
    { tekst: 'Mój PESEL to 44051401359 czy to prawda?' },
    { model1Impl: async (d) => d.tekst, researchImpl: async () => ({}), weryfikatorImpl: async () => ({}), monitoringImpl: mon }
  );
  await uruchomPipeline(
    { tekst: 'KUP TERAZ super promocja!!!' },
    {
      model1Impl: async (d) => d.tekst,
      filtrImpl: async () => ({ przepuscic: false, kategoria: 'spam', opis: 'spam', powod: 'reklama' }),
      researchImpl: async () => ({}),
      weryfikatorImpl: async () => ({}),
      monitoringImpl: mon,
    }
  );

  // Czekamy na dokończenie pracy kolejki w tle i weryfikujemy zapis w bazie
  await mon.przetworzWszystkoTeraz({ wymusPodsumowanie: false });
  const panel = mon.pobierzPanel();
  assert.equal(panel.podsumowanie.zgloszenia_lacznie, 1);
  assert.equal(panel.klastry[0].tytul, 'Loty rosyjskich samolotów nad Polską');

  const szczegoly = mon.pobierzSzczegoly(panel.klastry[0].id);
  assert.equal(szczegoly.warianty[0].ostatni_werdykt, 'Brak wystarczających dowodów');
});

test('Ochrona przed SQL injection i endpointy HTTP /api/alerty oraz /api/status', async (t) => {
  const mon = utworzMonitoring({
    sciezkaDb: tempDbPath(t),
    useLlm: false,
    progi: { PROG_GODZINA: 2, PROG_DZIEN: 2 },
    cichyLog: true,
  });
  t.after(() => mon.zamknij());

  // Próba SQL injection w treści promptu zapisywana parametryzowanie jako zwykły tekst
  mon.zglosPrompt({ tekst: "'; DROP TABLE prompty_uzytkownikow; -- czy nad polska lataja samoloty" });
  mon.zglosPrompt({ tekst: 'czy nad polska lataja samoloty rosyjskie?' });
  await mon.przetworzWszystkoTeraz({ wymusPodsumowanie: true });

  const app = utworzSerwer({ monitoring: mon });
  const serwer = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => serwer.close(resolve)));

  const port = serwer.address().port;
  const base = `http://127.0.0.1:${port}`;

  const statusRes = await fetch(`${base}/api/status`).then((r) => r.json());
  assert.equal(statusRes.status, 'ok');
  assert.equal(statusRes.monitoring.aktywny, true);

  const alertyRes = await fetch(`${base}/api/alerty`).then((r) => r.json());
  assert.equal(alertyRes.podsumowanie.zgloszenia_lacznie, 2);
  assert.equal(alertyRes.alerty.length, 1);

  const klasterId = alertyRes.klastry[0].id;
  const detRes = await fetch(`${base}/api/alerty/${klasterId}`).then((r) => r.json());
  assert.equal(detRes.klaster.id, klasterId);
  assert.ok(detRes.warianty.length >= 1);

  const alertId = alertyRes.alerty[0].id;
  const patchRes = await fetch(`${base}/api/alerty/${alertId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'monitorowany' }),
  });
  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.alert.status_alertu, 'monitorowany');

  const badStatus = await fetch(`${base}/api/alerty/${alertId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'niepoprawny' }),
  });
  assert.equal(badStatus.status, 400);

  const badId = await fetch(`${base}/api/alerty/0`);
  assert.equal(badId.status, 400);

  const missingId = await fetch(`${base}/api/alerty/99999`);
  assert.equal(missingId.status, 404);
});
