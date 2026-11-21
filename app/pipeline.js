// pipeline.js - Główny orkiestrator systemu KOMA / PRAWDOWID: Model 1 -> Model 2 -> Model 3 -> Demagog
const { walidujZapytanie, BladWalidacji } = require('./dodatki/zabezpieczenia');
const filtrTekstu = require('./filtr_tekstu/filtr_tekstu');
const { model2, Model2Error } = require('./rozpoznawacz_kontekstów/model2');
const model3 = require('./model3/model3');
const { demagog } = require('./demagog/demagog');

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

// SŁOWA UŻYTKOWNIKA ZOSTAJĄ BEZ ZMIAN.
// Model 2 przeredagowuje twierdzenia ("Autor tekstu słyszał, że...", "Pytanie dotyczy tego, czy...",
// dopisane imiona, pytania zamienione na stwierdzenia) i rozbija jedno zdanie na kilka przerobionych
// części. Dalej (wyszukiwanie, werdykt, ekran) idzie WYŁĄCZNIE oryginalny fragment tekstu
// użytkownika (source_text) - jedno zdanie użytkownika = jedno twierdzenie, słowo w słowo.
// Z Modelu 2 bierzemy tylko podział na zdania i typ (fakt / opinia).
const PYTANIE = /^\s*czy\s|\?\s*$/i;
const ZASLYSZANE = /^\s*(słyszał\w*|czytał\w*|podobno|ponoć|mówi\s+się|krąży\s+informacja|widział\w*)\b/i;
const TYPY_NIEFAKTOWE = new Set(['opinion', 'non_verifiable']);

function zachowajSlowaUzytkownika(claims) {
  const grupy = new Map(); // oryginalny fragment -> twierdzenia Modelu 2 z niego wydzielone
  for (const c of claims || []) {
    const zrodlo = typeof c?.source_text === 'string' && c.source_text.trim() ? c.source_text.trim() : String(c?.claim || '').trim();
    if (!zrodlo) continue;
    if (!grupy.has(zrodlo)) grupy.set(zrodlo, []);
    grupy.get(zrodlo).push(c);
  }

  const wynik = [];
  for (const [zrodlo, czesci] of grupy) {
    const pierwszy = czesci[0];
    // Typ: fakt, jeśli którakolwiek część była faktem, albo jeśli to pytanie o fakt / zasłyszana informacja.
    // Opinia tylko wtedy, gdy wszystkie części Model 2 uznał za opinię i nie jest to pytanie.
    const faktowa = czesci.find((c) => !TYPY_NIEFAKTOWE.has(c.type) && c.type !== 'attribution');
    let typ = faktowa ? faktowa.type : pierwszy.type;
    if (PYTANIE.test(zrodlo) || ZASLYSZANE.test(zrodlo) || typ === 'attribution') {
      typ = faktowa ? faktowa.type : 'event';
    }
    wynik.push({
      ...pierwszy,
      claim: zrodlo,
      source_text: zrodlo,
      type: typ,
      related_to: [],
      ambiguous: czesci.some((c) => c.ambiguous),
      ambiguity: czesci.map((c) => c.ambiguity).filter(Boolean).join(' ') || pierwszy.ambiguity,
    });
  }
  return wynik;
}

function mapujBladModelu2(err) {
  if (err instanceof Model2Error) {
    let status = 502;
    if (err.code === 'INVALID_INPUT') status = 400;
    else if (err.code === 'TIMEOUT') status = 504;
    return new PipelineError(`Błąd Modelu 2 (${err.code}): ${err.message}`, {
      status,
      etap: 'model2',
      kod: err.code,
      cause: err,
    });
  }
  return new PipelineError(`Nieoczekiwany błąd Modelu 2: ${err.message}`, {
    status: 502,
    etap: 'model2',
    kod: 'MODEL2_UNEXPECTED',
    cause: err,
  });
}

function mapujBladModelu3(err) {
  const kod = err?.code || 'MODEL3_ERROR';
  const status = kod === 'INVALID_INPUT' ? 400 : 502;
  return new PipelineError(`Błąd Modelu 3 (${kod}): ${err.message}`, {
    status,
    etap: 'model3',
    kod,
    cause: err,
  });
}

/**
 * Uruchamia pełny przepływ:
 * 0. Walidacja wejścia (tekst, linki, zdjęcia)
 * 1. Model 1 (filtr_tekstu: rozdzielenie, webscraper, OCR, filtrowanie po temacie)
 * 2. Model 2 (dekompozycja wypowiedzi na atomowe twierdzenia JSON)
 * 3. Model 3 (zbieranie dowodów z katalogu 40 oficjalnych źródeł)
 *
 * @param {object} body - Surowe body zapytania HTTP { tekst?, linki?, zdjecia?, film? }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function uruchomPipeline(body, options = {}) {
  const startCalkowity = Date.now();
  const etapyUkonczone = [];
  const ostrzezenia = [];

  const model1Fn = options.model1Impl || ((dane) => filtrTekstu.konwertuj(dane));
  const model2Fn = options.model2Impl || ((tekst) => model2(tekst, options.model2));
  const model3Fn = options.model3Impl || ((claims) => model3(claims, options.model3));
  const demagogFn = options.demagogImpl || ((m2, m3) => demagog(m2, m3, options.demagog));

  // 0. Walidacja danych wejściowych
  const dane = walidujZapytanie(body);

  // 1. MODEL 1 – ekstrakcja i filtrowanie danych wejściowych
  const t1 = Date.now();
  let tekstPoModelu1;
  try {
    tekstPoModelu1 = await model1Fn(dane);
  } catch (err) {
    if (err instanceof BladWalidacji) {
      err.etap = 'model1';
      throw err;
    }
    if (err?.publiczny) {
      err.etap = 'model1';
      throw err;
    }
    throw new PipelineError(`Błąd Modelu 1: ${err.message}`, {
      status: 502,
      etap: 'model1',
      kod: 'MODEL1_ERROR',
      cause: err,
    });
  }
  const czasModel1Ms = Date.now() - t1;
  etapyUkonczone.push('model1');

  if (typeof tekstPoModelu1 !== 'string' || tekstPoModelu1.trim().length === 0) {
    throw new PipelineError('Model 1 nie wyodrębnił żadnego tekstu do dalszej analizy.', {
      status: 400,
      etap: 'model1',
      kod: 'EMPTY_EXTRACTED_TEXT',
    });
  }

  // 2. MODEL 2 – dekompozycja na atomowe twierdzenia
  const t2 = Date.now();
  let wynikModelu2;
  try {
    wynikModelu2 = await model2Fn(tekstPoModelu1);
  } catch (err) {
    throw mapujBladModelu2(err);
  }
  const czasModel2Ms = Date.now() - t2;
  etapyUkonczone.push('model2');
  wynikModelu2.claims = zachowajSlowaUzytkownika(wynikModelu2.claims);

  if (!wynikModelu2.claims || wynikModelu2.claims.length === 0) {
    ostrzezenia.push('Model 2 nie wyodrębnił żadnych twierdzeń do weryfikacji w przesłanym materiale.');
  }

  // 3. MODEL 3 – zbieranie dowodów z katalogu 40 zaufanych źródeł
  const t3 = Date.now();
  let wynikModelu3;
  try {
    wynikModelu3 = await model3Fn(wynikModelu2);
  } catch (err) {
    throw mapujBladModelu3(err);
  }
  const czasModel3Ms = Date.now() - t3;
  etapyUkonczone.push('model3');

  // 4. DEMAGOG – werdykt i uzasadnienie na podstawie dowodów z Modelu 3
  const t4 = Date.now();
  let wynikDemagoga;
  try {
    wynikDemagoga = await demagogFn(wynikModelu2, wynikModelu3);
  } catch (err) {
    throw new PipelineError(`Błąd modułu Demagog: ${err.message}`, {
      status: 502,
      etap: 'demagog',
      kod: err?.code || 'DEMAGOG_ERROR',
      cause: err,
    });
  }
  const czasDemagogMs = Date.now() - t4;
  etapyUkonczone.push('demagog');

  const liczbaDowodow = (wynikModelu3.claims || []).reduce(
    (suma, c) => suma + (Array.isArray(c.evidence) ? c.evidence.length : 0),
    0
  );

  return {
    status: wynikModelu3.status,
    werdykt_ogolny: wynikDemagoga.werdykt_ogolny,
    tekst: tekstPoModelu1, // zachowana wsteczna kompatybilność z wcześniejszym API /api/weryfikuj
    model1: {
      tekst: tekstPoModelu1,
      czas_ms: czasModel1Ms,
    },
    model2: {
      original_text: wynikModelu2.original_text,
      claims: wynikModelu2.claims,
      czas_ms: czasModel2Ms,
    },
    model3: {
      ...wynikModelu3,
      czas_ms: czasModel3Ms,
    },
    demagog: {
      ...wynikDemagoga,
      czas_ms: czasDemagogMs,
    },
    metadane: {
      czas_calkowity_ms: Date.now() - startCalkowity,
      etapy_ukonczone: etapyUkonczone,
      liczba_twierdzen: wynikModelu2.claims.length,
      liczba_dowodow: liczbaDowodow,
      ostrzezenia,
      security_flags: wynikModelu3.security_flags || [],
    },
  };
}

module.exports = {
  PipelineError,
  uruchomPipeline,
  zachowajSlowaUzytkownika,
};
