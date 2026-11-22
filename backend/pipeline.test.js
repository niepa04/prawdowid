const test = require('node:test');
const assert = require('node:assert/strict');
const { uruchomPipeline } = require('./pipeline');
const { normalizujUrlGenerate } = require('./ekstrakcja/ekstrakcjaTresci');
const { BladWalidacji } = require('./wspolne/zabezpieczenia');
const { zbierzResearch } = require('./research/researchGatherer');
const { weryfikujPrawde, sprawdzTeze, werdyktOgolny, wiernyCytat } = require('./weryfikator/weryfikatorPrawdy');

function makeMockResponse({ status = 200, headers = {}, body = '' }) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headerMap.get(String(k).toLowerCase()) || null },
    text: async () => body,
  };
}

// Podstawiony serwer modeli: kolejne odpowiedzi JSON dla kolejnych wywołań /api/chat
function ollamaZOdpowiedziami(...odpowiedzi) {
  let i = 0;
  return async () => {
    const tresc = odpowiedzi[Math.min(i++, odpowiedzi.length - 1)];
    return { ok: true, json: async () => ({ done: true, message: { content: JSON.stringify(tresc) } }) };
  };
}

test('normalizujUrlGenerate zapewnia spójny adres Ollamy', () => {
  for (const u of ['http://100.127.211.111:11434', 'http://100.127.211.111:11434/', 'http://100.127.211.111:11434/api/generate', 'http://100.127.211.111:11434/api/chat']) {
    assert.equal(normalizujUrlGenerate(u), 'http://100.127.211.111:11434/api/generate');
  }
});

test('uruchomPipeline przekazuje CAŁY tekst do Research Gatherera i Weryfikatora i zwraca format dla frontendu', async () => {
  let doResearchu = null;
  let doWeryfikatora = null;
  const wynik = await uruchomPipeline(
    { tekst: 'W Krakowie bilet kosztuje 8 zł. Czy to najdroższy bilet w Polsce?' },
    {
      researchImpl: async (t) => {
        doResearchu = t;
        return { plan: { temat: 'bilety' }, materialy: [{ nr: 1 }], notatka: { streszczenie: 'x' }, ostrzezenia: [], status: 'completed', czas_ms: 1 };
      },
      weryfikatorImpl: async (t, r) => {
        doWeryfikatora = { t, r };
        return { werdykt_ogolny: 'Potwierdzone', twierdzenia: [{ claim: 'W Krakowie bilet kosztuje 8 zł.', werdykt: 'Potwierdzone', uzyte_zrodla: [] }], czas_ms: 1 };
      },
    }
  );
  assert.ok(doResearchu.includes('W Krakowie bilet kosztuje 8 zł. Czy to najdroższy bilet w Polsce?'));
  assert.equal(doWeryfikatora.t, doResearchu);
  assert.equal(doWeryfikatora.r.plan.temat, 'bilety');
  assert.equal(wynik.werdykt_ogolny, 'Potwierdzone');
  assert.equal(wynik.demagog.twierdzenia.length, 1);
  assert.equal(wynik.research.materialy.length, 1);
  assert.deepEqual(wynik.metadane.etapy_ukonczone, ['model1', 'filtr_danych_osobowych', 'research', 'weryfikator']);
});

test('uruchomPipeline odrzuca puste zapytanie (400) oraz nieobsługiwany film (501)', async () => {
  await assert.rejects(() => uruchomPipeline({ tekst: '   ' }), (err) => err instanceof BladWalidacji && err.status === 400);
  await assert.rejects(() => uruchomPipeline({ film: 'video.mp4' }), (err) => err instanceof BladWalidacji && err.status === 501);
});

test('Filtr wstępny zatrzymuje zgłoszenie przed researchem', async () => {
  let researchWywolany = false;
  const wynik = await uruchomPipeline(
    { tekst: 'KUP TERAZ super promocja!!!' },
    {
      filtrImpl: async () => ({ przepuscic: false, kategoria: 'spam', opis: 'spam lub reklama', powod: 'To reklama.' }),
      researchImpl: async () => {
        researchWywolany = true;
        return {};
      },
      weryfikatorImpl: async () => ({}),
    }
  );
  assert.equal(researchWywolany, false);
  assert.equal(wynik.status, 'rejected');
  assert.equal(wynik.metadane.odrzucone_przez_filtr, true);
  assert.match(wynik.demagog.glowna_odpowiedz, /spam/);
});

test('Research Gatherer: plan -> zbieranie dla każdego pytania + całego zgłoszenia -> scalone materiały (fact-checker pierwszy) -> notatka', async () => {
  let zapytaniaDoModelu3 = null;
  const r = await zbierzResearch('Czy ABW zatrzymało ukraińskich szpiegów?', {
    fetchImpl: ollamaZOdpowiedziami(
      { temat: 'ABW i szpiedzy', pytania_badawcze: [{ pytanie: 'Czy ABW zatrzymało szpiegów działających dla Ukrainy?', zapytanie: 'ABW szpiedzy Ukraina' }], podmioty: ['ABW'] },
      { streszczenie: 'ABW zatrzymało szpiegów działających dla Rosji.', ustalenia: [{ pytanie: 'p1', tresc: 'Działali dla Rosji.', zrodla: [1, 99] }], oceny_fact_checkerow: [], luki: [] }
    ),
    model3Impl: async (wejscie) => {
      zapytaniaDoModelu3 = wejscie.claims;
      const gov = { source_id: 'SRC038', source_type: 'official_government', title: 'ABW: zatrzymani działali na rzecz Rosji', url: 'https://www.gov.pl/a', relevance: 'direct', relevant_excerpts: ['Zatrzymani działali na rzecz Rosji.'] };
      const fc = { source_id: 'FACTCHECK', source_type: 'fact_checking', title: 'Ocena Demagog: ABW', url: 'https://demagog.org.pl/x', relevance: 'direct', relevant_excerpts: ['ocena: Fałsz'], fact_check_rating: 'Fałsz' };
      return { status: 'completed', claims: [{ claim_id: 'p1', evidence: [gov, fc] }, { claim_id: 'p0', evidence: [fc] }] };
    },
  });
  assert.deepEqual(zapytaniaDoModelu3.map((c) => c.id), ['p1', 'u1']); // pytanie badawcze + zdanie użytkownika
  assert.equal(zapytaniaDoModelu3[1].claim, 'Czy ABW zatrzymało ukraińskich szpiegów?');
  assert.equal(r.materialy.length, 2); // bez duplikatu oceny fact-checkera
  assert.equal(r.materialy[0].source_id, 'FACTCHECK');
  assert.equal(r.materialy[0].ocena_fact_checkera, 'Fałsz');
  assert.deepEqual(r.notatka.ustalenia[0].zrodla, [1]); // nieistniejący materiał 99 odrzucony
});

test('Research Gatherer z prawdziwym Modelem 3 znajduje komunikat gov.pl przez /api/data/search', async () => {
  const r = await zbierzResearch('Karol Nawrocki jest prezydentem Polski.', {
    fetchImpl: ollamaZOdpowiedziami(
      { temat: 'prezydent', pytania_badawcze: [{ pytanie: 'Karol Nawrocki jest prezydentem Polski.', zapytanie: 'Karol Nawrocki prezydent' }] },
      { streszczenie: 'ok', ustalenia: [], oceny_fact_checkerow: [], luki: [] }
    ),
    model3: {
      nowMs: Date.parse('2026-11-21T15:00:00Z'),
      maxRounds: 2,
      factCheckApiKey: null,
      fetchImpl: async (url) => {
        if (url.startsWith('https://www.gov.pl/api/data/search')) {
          return makeMockResponse({
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ count: 1, results: [{ title: 'Prezydent RP Karol Nawrocki na uroczystości otwarcia Via Baltica', intro: 'Karol Nawrocki złożył wizytę jako Prezydent Polski.', url: '/web/litwa/prezydent-rp-karol-nawrocki' }] }),
          });
        }
        if (url === 'https://www.gov.pl/web/litwa/prezydent-rp-karol-nawrocki') {
          return makeMockResponse({
            headers: { 'content-type': 'text/html' },
            body: '<html><head><title>Prezydent RP Karol Nawrocki</title></head><body><main><p>Prezydent RP Karol Nawrocki reprezentował Polskę podczas uroczystości otwarcia litewskiego odcinka Via Baltica.</p></main></body></html>',
          });
        }
        return makeMockResponse({ headers: { 'content-type': 'text/html' }, body: '<html><body><main><p>Strona główna KPRM.</p></main></body></html>' });
      },
    },
  });
  assert.ok(r.materialy.some((m) => /Via Baltica/.test(m.fragmenty.join(' ') + m.tytul)));
});

const M = (nr, extra = {}) => ({ nr, source_id: 'SRC001', tytul: `Materiał ${nr}`, wydawca: 'gov.pl', url: `https://www.gov.pl/${nr}`, fragmenty: [], ...extra });

test('Weryfikator: brak potwierdzenia to nie zaprzeczenie ("Fałszywe" bez dowodu zaprzeczającego -> Brak)', () => {
  const s = sprawdzTeze({ typ: 'fakt', werdykt: 'Fałszywe', uzasadnienie: 'Nic o tym nie piszą.', dowody: [{ nr: 1, na_temat: true, stanowisko: 'nie_rozstrzyga' }] }, [M(1)]);
  assert.equal(s.werdykt, 'Brak wystarczających dowodów');
  assert.deepEqual(s.zrodla, []);
});

test('Weryfikator: dowody nie na temat nie mogą rozstrzygać (pytanie jest priorytetem)', () => {
  const s = sprawdzTeze({ typ: 'fakt', werdykt: 'Fałszywe', uzasadnienie: 'Tusk zapowiadał, że nikt nie wejdzie.', dowody: [{ nr: 1, na_temat: false, stanowisko: 'zaprzecza' }] }, [M(1)]);
  assert.equal(s.werdykt, 'Brak wystarczających dowodów');
});

test('Weryfikator: ocena fact-checkera na temat rozstrzyga, także dla twierdzenia przeciwnego', () => {
  // ocena dotyczy tej samej tezy -> rozstrzyga, nawet gdy model nie wskazał stanowiska
  const fc = M(1, { ocena_fact_checkera: 'Fałsz', wydawca: 'Demagog', oceniane_twierdzenie: 'Szczepionki powodują autyzm u dzieci' });
  assert.equal(sprawdzTeze({ typ: 'fakt', cytat: 'Szczepionki powodują autyzm u dzieci.', werdykt: 'Brak wystarczających dowodów', dowody: [{ nr: 1, na_temat: true, stanowisko: 'nie_rozstrzyga' }] }, [fc]).werdykt, 'Fałszywe');
  // ocena innego twierdzenia (inne liczby, inny okres) bez stanowiska modelu -> nie rozstrzyga
  const inna = M(2, { ocena_fact_checkera: 'Prawda', wydawca: 'Demagog', oceniane_twierdzenie: 'Cena masła wzrosła o 91 proc. w ciągu 8 lat', tytul: 'Według NBP ceny nie rosną. Ile wzrosły przez ostatnie 8 lat?' });
  assert.equal(sprawdzTeze({ typ: 'fakt', cytat: 'Ceny masła w Polsce wzrosły w listopadzie o 3 procent', werdykt: 'Brak wystarczających dowodów', dowody: [{ nr: 2, na_temat: true, stanowisko: 'nie_rozstrzyga' }] }, [inna]).werdykt, 'Brak wystarczających dowodów');
  const przeciwne = M(1, { ocena_twierdzenia_przeciwnego: 'Fałsz', oceniane_twierdzenie: 'Szczepionki powodują autyzm', wydawca: 'Demagog' });
  assert.equal(sprawdzTeze({ typ: 'fakt', cytat: 'Szczepionki nie powodują autyzmu.', werdykt: 'Fałszywe', dowody: [{ nr: 1, na_temat: true, stanowisko: 'nie_rozstrzyga' }] }, [przeciwne]).werdykt, 'Potwierdzone');
  // ocena fact-checkera uznana za nie na temat nie rozstrzyga
  assert.equal(sprawdzTeze({ typ: 'fakt', werdykt: 'Brak wystarczających dowodów', dowody: [{ nr: 1, na_temat: false }] }, [fc]).werdykt, 'Brak wystarczających dowodów');
});

test('Weryfikator: opinia -> Nie podlega weryfikacji; werdykt ogólny z tez', () => {
  assert.equal(sprawdzTeze({ typ: 'opinia', werdykt: 'Potwierdzone' }, []).werdykt, 'Nie podlega weryfikacji');
  assert.equal(werdyktOgolny([{ werdykt: 'Potwierdzone' }, { werdykt: 'Fałszywe' }]), 'Wprowadzające w błąd');
  assert.equal(werdyktOgolny([{ werdykt: 'Fałszywe' }, { werdykt: 'Brak wystarczających dowodów' }]), 'Fałszywe');
  assert.equal(werdyktOgolny([{ werdykt: 'Nie podlega weryfikacji' }]), 'Nie podlega weryfikacji');
});

test('Weryfikator: cytat zawsze słowo w słowo z tekstu użytkownika', async () => {
  const tekst = '===== [TEKST] =====\nSłyszałem, że teraz głową państwa jest Nawrocki. Pozdrawiam.';
  assert.equal(wiernyCytat('Słyszałem, że teraz głową państwa jest Nawrocki', tekst), 'Słyszałem, że teraz głową państwa jest Nawrocki');
  assert.equal(wiernyCytat('Autor słyszał, że Jarosław Nawrocki jest głową państwa', tekst), 'Słyszałem, że teraz głową państwa jest Nawrocki.');

  const w = await weryfikujPrawde(tekst, { materialy: [M(1, { tytul: 'Prezydent RP Karol Nawrocki' })], notatka: {} }, {
    fetchImpl: ollamaZOdpowiedziami({
      tezy: [{ cytat: 'Autor słyszał, że Jarosław Nawrocki jest głową państwa', typ: 'fakt', sedno: 'Nawrocki jest głową państwa', dowody: [{ nr: 1, na_temat: true, stanowisko: 'potwierdza', fragment: 'Prezydent RP Karol Nawrocki' }], werdykt: 'Potwierdzone', uzasadnienie: 'Gov.pl nazywa go Prezydentem RP.', zrodla: [1] }],
    }),
  });
  assert.equal(w.twierdzenia[0].claim, 'Słyszałem, że teraz głową państwa jest Nawrocki.');
  assert.equal(w.werdykt_ogolny, 'Potwierdzone');
  assert.equal(w.twierdzenia[0].uzyte_zrodla[0].url, 'https://www.gov.pl/1');
});

test('Weryfikator: stanowisko bez dosłownego fragmentu z materiału nie rozstrzyga (zmyślony cytat)', () => {
  const m = M(1, { tytul: 'Komunikat MSZ: zapowiedziano strajk generalny na 20 listopada', fragmenty: ['W dniu 20 listopada zapowiedziano strajk generalny.'] });
  const zmyslony = sprawdzTeze({ typ: 'fakt', werdykt: 'Fałszywe', dowody: [{ nr: 1, na_temat: true, stanowisko: 'zaprzecza', fragment: 'strajk generalny się nie odbył' }] }, [m]);
  assert.equal(zmyslony.werdykt, 'Brak wystarczających dowodów');
  const prawdziwy = sprawdzTeze({ typ: 'fakt', werdykt: 'Potwierdzone', uzasadnienie: 'MSZ informuje o strajku.', dowody: [{ nr: 1, na_temat: true, stanowisko: 'potwierdza', fragment: 'zapowiedziano strajk generalny' }] }, [m]);
  assert.equal(prawdziwy.werdykt, 'Potwierdzone');
});

test('Awaria wyszukiwania: "Nie można teraz sprawdzić" zamiast "brak dowodów", bez weryfikatora', async () => {
  let weryfikatorWolany = false;
  const wynik = await uruchomPipeline(
    { tekst: 'Szczepionki powodują autyzm.' },
    {
      model1Impl: async (d) => d.tekst,
      researchImpl: async () => ({
        plan: { temat: 't', pytania_badawcze: [] },
        materialy: [],
        notatka: { streszczenie: '' },
        ostrzezenia: ['Baza fact-checkerów Google była niedostępna (fetch failed).'],
        status: 'technical_error',
        dostepnosc: { awaria: true, baza_fact_checkerow: false, zrodla_oficjalne: false },
      }),
      weryfikatorImpl: async () => {
        weryfikatorWolany = true;
        return {};
      },
    }
  );
  assert.equal(wynik.status, 'unavailable');
  assert.equal(wynik.werdykt_ogolny, 'Nie można teraz sprawdzić');
  assert.match(wynik.demagog.glowna_odpowiedz, /NIE znaczy, że nie ma/);
  assert.equal(weryfikatorWolany, false);
});

test('Niedostępna baza fact-checkerów: "brak dowodów" zamieniony na "Nie można teraz sprawdzić"', async () => {
  const wynik = await uruchomPipeline(
    { tekst: 'Coś się wydarzyło w Warszawie.' },
    {
      model1Impl: async (d) => d.tekst,
      researchImpl: async () => ({
        plan: { temat: 't', pytania_badawcze: [] },
        materialy: [M(1)],
        notatka: { streszczenie: '' },
        ostrzezenia: [],
        status: 'completed',
        dostepnosc: { awaria: false, baza_fact_checkerow: false, zrodla_oficjalne: true },
      }),
      weryfikatorImpl: async () => ({
        werdykt_ogolny: 'Brak wystarczających dowodów',
        twierdzenia: [
          { claim_id: 't1', claim: 'A', werdykt: 'Brak wystarczających dowodów' },
          { claim_id: 't2', claim: 'B', werdykt: 'Fałszywe' },
        ],
      }),
    }
  );
  assert.equal(wynik.werdykt_ogolny, 'Nie można teraz sprawdzić');
  assert.equal(wynik.demagog.twierdzenia[0].werdykt, 'Nie można teraz sprawdzić');
  assert.equal(wynik.demagog.twierdzenia[1].werdykt, 'Fałszywe');
});

test('Model nie odpowiada: błąd 503 z informacją, że teraz nie da się sprawdzić', async () => {
  await assert.rejects(
    uruchomPipeline(
      { tekst: 'Szczepionki powodują autyzm.' },
      {
        model1Impl: async (d) => d.tekst,
        researchImpl: async () => ({ plan: { pytania_badawcze: [] }, materialy: [M(1)], notatka: {}, ostrzezenia: [], dostepnosc: { awaria: false, baza_fact_checkerow: true } }),
        weryfikatorImpl: async () => {
          throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        },
      }
    ),
    (err) => err.status === 503 && /nie da się teraz/.test(err.message)
  );
});
