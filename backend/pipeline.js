// pipeline.js - Główny orkiestrator systemu KOMA
//
//   1. ekstrakcja/          (Model 1) tekst / OCR zdjęć / treść stron z linków, z podziałem na sekcje
//   2. ochrona_danych/      dane osobowe: blokada (tekst, zdjęcia) albo wycięcie (strony z linków)
//   3. filtr_wstepny/       spam, bełkot, small talk, same polecenia i dane osób prywatnych nie idą dalej
//   4. research/            Research Gatherer: plan -> wyszukiwarka_dowodow/ (źródła, fact-checkerzy) -> notatka
//   5. weryfikator/         Weryfikator Prawdy: porównanie CAŁEGO zgłoszenia z notatką i materiałami -> werdykty
//
// Prompty, modele, źródła i limity: folder config/ w głównym katalogu.
// Odpowiedź ma dotychczasowy kształt (werdykt_ogolny, demagog.twierdzenia, ...), żeby frontend
// i test działały bez zmian; dochodzi pole "research" z planem, materiałami i notatką.
const crypto = require('crypto');
const { walidujZapytanie, BladWalidacji } = require('./wspolne/zabezpieczenia');
const filtrTekstu = require('./ekstrakcja/ekstrakcjaTresci');
const { zbierzResearch } = require('./research/researchGatherer');
const { weryfikujPrawde } = require('./weryfikator/weryfikatorPrawdy');
const { filtrujZgloszenie } = require('./filtr_wstepny/filtrWstepny');
const { zarejestrujNierozstrzygniete } = require('./wspolne/rejestrNierozstrzygnietych');
const { sprawdzDaneOsobowe } = require('./ochrona_danych/daneOsobowe');
const { pobierzDomyslnyMonitoring } = require('./monitoring_promptow');

const ZABLOKOWANE_DANE = 'Zablokowano: dane osobowe';

// Zgłoszenie z danymi osobowymi - nie idzie dalej (do modeli researchu ani wyszukiwarek).
// wykryte: rodzaje danych (np. "numer PESEL"), bez samych wartości.
function wynikDaneOsobowe(tekst, czasModel1Ms, wykryte, metoda, startCalkowity) {
  const co = wykryte.length ? ` Wykryliśmy: ${wykryte.join(', ')}.` : '';
  const komunikat =
    `Nie można używać danych osobowych w zapytaniach.${co} ` +
    'Usuń je i spróbuj ponownie – np. zamiast adresu wpisz samo miasto, a zamiast imienia i nazwiska osoby prywatnej „mieszkaniec”, „sąsiad”, „kobieta”.';
  return {
    status: 'rejected',
    werdykt_ogolny: ZABLOKOWANE_DANE,
    tekst,
    model1: { tekst, czas_ms: czasModel1Ms },
    research: null,
    demagog: { werdykt_ogolny: ZABLOKOWANE_DANE, glowna_odpowiedz: komunikat, glowne_zrodla: [], twierdzenia: [], czas_ms: 0 },
    filtr_wstepny: { przepuscic: false, kategoria: 'dane_osobowe', opis: 'dane osobowe', powod: komunikat, metoda, wykryte },
    metadane: {
      czas_calkowity_ms: Date.now() - startCalkowity,
      etapy_ukonczone: ['model1', 'filtr_danych_osobowych'],
      liczba_twierdzen: 0,
      liczba_dowodow: 0,
      ostrzezenia: [],
      security_flags: [{ type: 'personal_data', reason: wykryte.join(', ') || 'dane osobowe osoby prywatnej' }],
      odrzucone_przez_filtr: true,
      dane_osobowe: true,
    },
  };
}

class PipelineError extends Error {
  constructor(wiadomosc, { status = 502, etap = 'pipeline', kod = 'PIPELINE_ERROR', cause = null } = {}) {
    super(wiadomosc);
    this.name = 'PipelineError';
    this.status = status;
    this.etap = etap;
    this.kod = kod;
    this.publiczny = true;
    if (cause) this.cause = cause;
  }
}

// Odpowiedź dla zgłoszenia zatrzymanego przez filtr wstępny - ten sam kształt co pełny wynik
function wynikOdrzucony(tekst, czasModel1Ms, decyzja, startCalkowity) {
  const komunikat =
    `Nie sprawdzamy tego zgłoszenia, bo to ${decyzja.opis}. ` +
    (decyzja.powod ? `${decyzja.powod} ` : '') +
    'Wpisz konkretną informację albo pytanie o fakt, np. „Czy w Warszawie ogłoszono stan wyjątkowy?”.';
  return {
    status: 'rejected',
    werdykt_ogolny: 'Nie podlega weryfikacji',
    tekst,
    model1: { tekst, czas_ms: czasModel1Ms },
    research: null,
    demagog: {
      werdykt_ogolny: 'Nie podlega weryfikacji',
      glowna_odpowiedz: komunikat,
      glowne_zrodla: [],
      twierdzenia: [],
      czas_ms: 0,
    },
    filtr_wstepny: decyzja,
    metadane: {
      czas_calkowity_ms: Date.now() - startCalkowity,
      etapy_ukonczone: ['model1', 'filtr_wstepny'],
      liczba_twierdzen: 0,
      liczba_dowodow: 0,
      ostrzezenia: [],
      security_flags: decyzja.kategoria === 'polecenie' ? [{ type: 'input_command_only', reason: decyzja.powod }] : [],
      odrzucone_przez_filtr: true,
    },
  };
}

const NIEDOSTEPNE = 'Nie można teraz sprawdzić';
const KOMUNIKAT_NIEDOSTEPNE =
  'Wyszukiwarka źródeł (baza fact-checkerów i strony oficjalne) jest teraz niedostępna, więc nie mogliśmy tego sprawdzić. ' +
  'To NIE znaczy, że nie ma na ten temat artykułów ani dowodów. Spróbuj ponownie za kilka minut.';

// Błąd sieci / przekroczony czas przy serwerze modeli - "nie da się teraz sprawdzić", a nie błąd zgłoszenia
function bladNiedostepnosci(err) {
  const kod = err?.cause?.code || err?.code || '';
  return err?.name === 'TimeoutError' || err?.name === 'AbortError' ||
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|Ollama HTTP 5\d\d/i.test(`${err?.message} ${kod}`);
}

// Odpowiedź, gdy wyszukiwanie nie działało - ten sam kształt co pełny wynik
function wynikNiedostepny(tekst, czasModel1Ms, research, startCalkowity, etapyUkonczone) {
  return {
    status: 'unavailable',
    werdykt_ogolny: NIEDOSTEPNE,
    tekst,
    model1: { tekst, czas_ms: czasModel1Ms },
    research: { plan: research.plan, notatka: research.notatka, materialy: [], czas_ms: research.czas_ms, dostepnosc: research.dostepnosc },
    demagog: { werdykt_ogolny: NIEDOSTEPNE, glowna_odpowiedz: KOMUNIKAT_NIEDOSTEPNE, glowne_zrodla: [], twierdzenia: [], czas_ms: 0 },
    metadane: {
      czas_calkowity_ms: Date.now() - startCalkowity,
      etapy_ukonczone: etapyUkonczone,
      liczba_twierdzen: 0,
      liczba_dowodow: 0,
      ostrzezenia: research.ostrzezenia || [],
      security_flags: research.security_flags || [],
      niedostepne: true,
    },
  };
}

// Baza fact-checkerów nie odpowiadała: "brak dowodów" jest wtedy niewiarygodny (najważniejsze
// źródło ocen nie zostało przeszukane), więc mówimy wprost, że teraz nie da się tego sprawdzić.
function oznaczNiedostepne(weryfikacja) {
  let zmienione = 0;
  const twierdzenia = (weryfikacja.twierdzenia || []).map((t) => {
    if (t.werdykt !== 'Brak wystarczających dowodów') return t;
    zmienione++;
    return {
      ...t,
      werdykt: NIEDOSTEPNE,
      uzasadnienie: 'Baza ocen fact-checkerów była w tej chwili niedostępna, a w pozostałych źródłach nic nie znaleźliśmy. Nie wiemy więc, czy są na ten temat artykuły – spróbuj ponownie za kilka minut.',
      metoda: 'niedostepne_zrodla',
    };
  });
  if (!zmienione) return weryfikacja;
  const glowneNiedostepne = weryfikacja.werdykt_ogolny === 'Brak wystarczających dowodów';
  return {
    ...weryfikacja,
    twierdzenia,
    werdykt_ogolny: glowneNiedostepne ? NIEDOSTEPNE : weryfikacja.werdykt_ogolny,
    glowna_odpowiedz: glowneNiedostepne ? KOMUNIKAT_NIEDOSTEPNE : weryfikacja.glowna_odpowiedz,
  };
}

/**
 * @param {object} body - Surowe body zapytania HTTP { tekst?, linki?, zdjecia?, film? }
 * @param {object} [options] - podstawienia do testów: model1Impl, filtrImpl, researchImpl, weryfikatorImpl, rejestrImpl, monitoringImpl
 * @returns {Promise<object>}
 */
async function uruchomPipeline(body, options = {}) {
  const startCalkowity = Date.now();
  const etapyUkonczone = [];
  const trybTestowy = Boolean(options.researchImpl || options.weryfikatorImpl);

  const model1Fn = options.model1Impl || ((dane) => filtrTekstu.konwertuj(dane));
  const researchFn = options.researchImpl || ((tekst) => zbierzResearch(tekst, options.research || {}));
  const weryfikatorFn = options.weryfikatorImpl || ((tekst, research) => weryfikujPrawde(tekst, research, options.weryfikator || {}));
  const monitoring = options.monitoringImpl !== undefined ? options.monitoringImpl : trybTestowy ? null : pobierzDomyslnyMonitoring();
  const idZgloszenia = crypto.randomUUID();
  let zapisanoWMonitoringu = false;

  monitoring?.rozpocznijWeryfikacje?.();
  try {
    // 0. Walidacja danych wejściowych
    const dane = walidujZapytanie(body);

    // 1. MODEL 1 – ekstrakcja tekstu z tekstu, linków i zdjęć
    const t1 = Date.now();
    let tekst;
    try {
      tekst = await model1Fn(dane);
    } catch (err) {
      if (err instanceof BladWalidacji || err?.publiczny) {
        err.etap = 'model1';
        throw err;
      }
      throw new PipelineError(`Błąd Modelu 1: ${err.message}`, { status: 502, etap: 'model1', kod: 'MODEL1_ERROR', cause: err });
    }
    const czasModel1Ms = Date.now() - t1;
    etapyUkonczone.push('model1');

    if (typeof tekst !== 'string' || tekst.trim().length === 0) {
      throw new PipelineError('Nie udało się wyodrębnić żadnego tekstu do analizy.', { status: 400, etap: 'model1', kod: 'EMPTY_EXTRACTED_TEXT' });
    }

    // 1a. FILTR DANYCH OSOBOWYCH (zawsze, bez modelu): PESEL, dokumenty, konta, karty, telefony,
    // e-maile, adresy zamieszkania. W tekście i na zdjęciach -> blokada; na stronach z linków -> wycięcie.
    const ochrona = sprawdzDaneOsobowe(tekst);
    if (ochrona.zablokuj) return wynikDaneOsobowe(ochrona.tekst, czasModel1Ms, ochrona.wykryte, 'reguly', startCalkowity);
    tekst = ochrona.tekst;
    etapyUkonczone.push('filtr_danych_osobowych');

    // 1b. FILTR WSTĘPNY (w testach z podstawionymi modułami pomijany, chyba że podano filtrImpl).
    // Model ocenia też dane osobowe osób prywatnych, których reguły nie wykryją (np. nazwisko + choroba).
    const filtrFn = options.filtrImpl !== undefined ? options.filtrImpl : trybTestowy ? null : (t) => filtrujZgloszenie(t, options.filtr);
    if (filtrFn) {
      const decyzja = await filtrFn(tekst.replace(/=====\s*\[[^\]]+\]\s*=====/g, ' ').trim());
      if (decyzja && decyzja.przepuscic === false && decyzja.kategoria === 'dane_osobowe') {
        return wynikDaneOsobowe(tekst, czasModel1Ms, ['dane osobowe osoby prywatnej'], 'model', startCalkowity);
      }
      if (decyzja && decyzja.przepuscic === false) return wynikOdrzucony(tekst, czasModel1Ms, decyzja, startCalkowity);
      etapyUkonczone.push('filtr_wstepny');
    }

    // Monitoring w tle: zapis do SQLite po odrzuceniu danych osobowych i spamu, BEZ czekania na grupowanie AI
    const wpisMonitoringu = monitoring?.zglosPrompt?.({
      zewnetrzneId: idZgloszenia,
      tekst,
      teraz: new Date(),
    });
    zapisanoWMonitoringu = Boolean(wpisMonitoringu);

    // 2. RESEARCH GATHERER – plan, zbieranie materiałów, notatka
    let research;
    try {
      research = await researchFn(tekst);
    } catch (err) {
      if (zapisanoWMonitoringu) {
        monitoring?.aktualizujWynik?.(idZgloszenia, {
          statusWeryfikacji: bladNiedostepnosci(err) ? 'niedostepne' : 'blad',
        });
      }
      if (bladNiedostepnosci(err)) {
        throw new PipelineError('Wyszukiwarka źródeł jest teraz niedostępna – nie da się teraz tego sprawdzić. To nie znaczy, że nie ma na ten temat informacji. Spróbuj ponownie za kilka minut.', { status: 503, etap: 'research', kod: 'SEARCH_UNAVAILABLE', cause: err });
      }
      throw new PipelineError(`Błąd Research Gatherera: ${err.message}`, { status: 502, etap: 'research', kod: err?.code || 'RESEARCH_ERROR', cause: err });
    }
    etapyUkonczone.push('research');

    // Wyszukiwanie nie działało: nie wydajemy werdyktu "brak dowodów", tylko mówimy, że teraz się nie da
    if (research.dostepnosc?.awaria) {
      if (zapisanoWMonitoringu) {
        monitoring?.aktualizujWynik?.(idZgloszenia, {
          statusWeryfikacji: 'niedostepne',
          werdyktOgolny: NIEDOSTEPNE,
          tematResearchu: research?.plan?.temat || null,
        });
      }
      return wynikNiedostepny(tekst, czasModel1Ms, research, startCalkowity, etapyUkonczone);
    }

    // 3. WERYFIKATOR PRAWDY – porównanie zgłoszenia z researchem, werdykty
    let weryfikacja;
    try {
      weryfikacja = await weryfikatorFn(tekst, research);
    } catch (err) {
      if (zapisanoWMonitoringu) {
        monitoring?.aktualizujWynik?.(idZgloszenia, {
          statusWeryfikacji: 'blad',
          tematResearchu: research?.plan?.temat || null,
        });
      }
      if (bladNiedostepnosci(err) || /model weryfikujący nie odpowiedział/.test(err?.message)) {
        throw new PipelineError('Model analizujący jest teraz niedostępny albo przeciążony – nie da się teraz tego sprawdzić. To nie znaczy, że nie ma na ten temat informacji. Spróbuj ponownie za kilka minut.', { status: 503, etap: 'weryfikator', kod: 'MODEL_UNAVAILABLE', cause: err });
      }
      throw new PipelineError(`Błąd Weryfikatora Prawdy: ${err.message}`, { status: 502, etap: 'weryfikator', kod: 'WERYFIKATOR_ERROR', cause: err });
    }
    if (research.dostepnosc && research.dostepnosc.baza_fact_checkerow === false) weryfikacja = oznaczNiedostepne(weryfikacja);
    etapyUkonczone.push('weryfikator');

    if (zapisanoWMonitoringu) {
      monitoring?.aktualizujWynik?.(idZgloszenia, {
        statusWeryfikacji: 'zakonczona',
        werdyktOgolny: weryfikacja.werdykt_ogolny,
        tematResearchu: research?.plan?.temat || null,
      });
    }

    // Pętla informacji: nierozstrzygnięte sprawy trafiają do rejestru (z deduplikacją)
    const rejestr = options.rejestrImpl !== undefined ? options.rejestrImpl : trybTestowy ? null : zarejestrujNierozstrzygniete;
    const nierozstrzygniete = rejestr ? rejestr(weryfikacja.twierdzenia || []) : null;

    return {
      status: research.status || 'completed',
      werdykt_ogolny: weryfikacja.werdykt_ogolny,
      tekst,
      model1: { tekst, czas_ms: czasModel1Ms },
      research: {
        plan: research.plan,
        notatka: research.notatka,
        materialy: research.materialy || [],
        czas_ms: research.czas_ms,
        dostepnosc: research.dostepnosc,
      },
      demagog: weryfikacja, // nazwa pola zachowana dla frontendu
      metadane: {
        czas_calkowity_ms: Date.now() - startCalkowity,
        etapy_ukonczone: etapyUkonczone,
        liczba_twierdzen: (weryfikacja.twierdzenia || []).length,
        liczba_dowodow: (research.materialy || []).length,
        ostrzezenia: research.ostrzezenia || [],
        security_flags: research.security_flags || [],
        nierozstrzygniete,
      },
    };
  } finally {
    monitoring?.zakonczWeryfikacje?.();
  }
}

module.exports = { PipelineError, uruchomPipeline };
