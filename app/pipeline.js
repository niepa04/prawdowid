// pipeline.js - Główny orkiestrator systemu KOMA
//
//   Model 1 (filtr_tekstu)    tekst / OCR zdjęć / treść stron z linków, z podziałem na sekcje
//   Filtr wstępny             spam, bełkot, small talk i same polecenia nie idą dalej
//   Research Gatherer         plan researchu -> zbieranie materiałów ze źródeł -> notatka
//   Weryfikator Prawdy        porównanie CAŁEGO zgłoszenia z notatką i materiałami -> werdykty
//
// Odpowiedź ma dotychczasowy kształt (werdykt_ogolny, demagog.twierdzenia, ...), żeby frontend
// i test działały bez zmian; dochodzi pole "research" z planem, materiałami i notatką.
const { walidujZapytanie, BladWalidacji } = require('./dodatki/zabezpieczenia');
const filtrTekstu = require('./filtr_tekstu/filtr_tekstu');
const { zbierzResearch } = require('./research/researchGatherer');
const { weryfikujPrawde } = require('./weryfikator/weryfikatorPrawdy');
const { filtrujZgloszenie } = require('./filtr_wstepny/filtrWstepny');
const { zarejestrujNierozstrzygniete } = require('./dodatki/nierozstrzygniete');

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
 * @param {object} [options] - podstawienia do testów: model1Impl, filtrImpl, researchImpl, weryfikatorImpl, rejestrImpl
 * @returns {Promise<object>}
 */
async function uruchomPipeline(body, options = {}) {
  const startCalkowity = Date.now();
  const etapyUkonczone = [];
  const trybTestowy = Boolean(options.researchImpl || options.weryfikatorImpl);

  const model1Fn = options.model1Impl || ((dane) => filtrTekstu.konwertuj(dane));
  const researchFn = options.researchImpl || ((tekst) => zbierzResearch(tekst, options.research || {}));
  const weryfikatorFn = options.weryfikatorImpl || ((tekst, research) => weryfikujPrawde(tekst, research, options.weryfikator || {}));

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

  // 1b. FILTR WSTĘPNY (w testach z podstawionymi modułami pomijany, chyba że podano filtrImpl)
  const filtrFn = options.filtrImpl !== undefined ? options.filtrImpl : trybTestowy ? null : (t) => filtrujZgloszenie(t, options.filtr);
  if (filtrFn) {
    const decyzja = await filtrFn(tekst.replace(/=====\s*\[[^\]]+\]\s*=====/g, ' ').trim());
    if (decyzja && decyzja.przepuscic === false) return wynikOdrzucony(tekst, czasModel1Ms, decyzja, startCalkowity);
    etapyUkonczone.push('filtr_wstepny');
  }

  // 2. RESEARCH GATHERER – plan, zbieranie materiałów, notatka
  let research;
  try {
    research = await researchFn(tekst);
  } catch (err) {
    if (bladNiedostepnosci(err)) {
      throw new PipelineError('Wyszukiwarka źródeł jest teraz niedostępna – nie da się teraz tego sprawdzić. To nie znaczy, że nie ma na ten temat informacji. Spróbuj ponownie za kilka minut.', { status: 503, etap: 'research', kod: 'SEARCH_UNAVAILABLE', cause: err });
    }
    throw new PipelineError(`Błąd Research Gatherera: ${err.message}`, { status: 502, etap: 'research', kod: err?.code || 'RESEARCH_ERROR', cause: err });
  }
  etapyUkonczone.push('research');

  // Wyszukiwanie nie działało: nie wydajemy werdyktu "brak dowodów", tylko mówimy, że teraz się nie da
  if (research.dostepnosc?.awaria) return wynikNiedostepny(tekst, czasModel1Ms, research, startCalkowity, etapyUkonczone);

  // 3. WERYFIKATOR PRAWDY – porównanie zgłoszenia z researchem, werdykty
  let weryfikacja;
  try {
    weryfikacja = await weryfikatorFn(tekst, research);
  } catch (err) {
    if (bladNiedostepnosci(err) || /model weryfikujący nie odpowiedział/.test(err?.message)) {
      throw new PipelineError('Model analizujący jest teraz niedostępny albo przeciążony – nie da się teraz tego sprawdzić. To nie znaczy, że nie ma na ten temat informacji. Spróbuj ponownie za kilka minut.', { status: 503, etap: 'weryfikator', kod: 'MODEL_UNAVAILABLE', cause: err });
    }
    throw new PipelineError(`Błąd Weryfikatora Prawdy: ${err.message}`, { status: 502, etap: 'weryfikator', kod: 'WERYFIKATOR_ERROR', cause: err });
  }
  if (research.dostepnosc && research.dostepnosc.baza_fact_checkerow === false) weryfikacja = oznaczNiedostepne(weryfikacja);
  etapyUkonczone.push('weryfikator');

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
}

module.exports = { PipelineError, uruchomPipeline };
