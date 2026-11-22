// detektorNadaktywnosci.js - wykrywanie podejrzanej nadaktywności zapytań w bazie
// oraz tworzenie rzetelnych podsumowań sytuacyjnych dla obywateli i instytucji
// bez tworzenia lub powielania dezinformacji.

const { zapytajModelJson } = require('../wspolne/ollama');
const { ZADANIA } = require('../../config/modele');
const ustawienia = require('../../config/ustawienia');
const PROMPT_PODSUMOWANIA = require('../../config/prompty/podsumowanieAlertu');
const { wyczyscBialeZnaki } = require('./normalizacja');

const RANGA_POZIOMU = { podwyzszona: 1, wysoka: 2, krytyczna: 3 };
const KATEGORIE_WYSOKIEGO_RYZYKA = new Set(['bezpieczenstwo_militarne', 'zagrozenia_kryzysowe', 'zdrowie', 'cyberbezpieczenstwo']);

function pobierzProgi(nadpisania = {}) {
  return {
    PROG_GODZINA: nadpisania.PROG_GODZINA ?? ustawienia.MONITORING_PROG_GODZINA,
    PROG_DZIEN: nadpisania.PROG_DZIEN ?? ustawienia.MONITORING_PROG_DZIEN,
    PROG_WYSOKI_GODZINA: nadpisania.PROG_WYSOKI_GODZINA ?? ustawienia.MONITORING_PROG_WYSOKI_GODZINA,
    PROG_WYSOKI_DZIEN: nadpisania.PROG_WYSOKI_DZIEN ?? ustawienia.MONITORING_PROG_WYSOKI_DZIEN,
    PROG_KRYTYCZNY_GODZINA: nadpisania.PROG_KRYTYCZNY_GODZINA ?? ustawienia.MONITORING_PROG_KRYTYCZNY_GODZINA,
    PROG_KRYTYCZNY_DZIEN: nadpisania.PROG_KRYTYCZNY_DZIEN ?? ustawienia.MONITORING_PROG_KRYTYCZNY_DZIEN,
    PROG_UDZIAL_DZIEN: nadpisania.PROG_UDZIAL_DZIEN ?? ustawienia.MONITORING_PROG_UDZIAL_DZIEN,
    MIN_DO_UDZIALU: nadpisania.MIN_DO_UDZIALU ?? ustawienia.MONITORING_MIN_DO_UDZIALU,
    MNOZNIK_SKOKU: nadpisania.MNOZNIK_SKOKU ?? ustawienia.MONITORING_MNOZNIK_SKOKU,
  };
}

function ocenaRyzykaZStatystyk(klaster, statystyki) {
  const r = statystyki.rozklad_werdyktow || {};
  const falsz = Number(r['Fałszywe'] || 0) + Number(r['Wprowadzające w błąd'] || 0);
  const brak = Number(r['Brak wystarczających dowodów'] || 0);
  const prawda = Number(r['Potwierdzone'] || 0);

  if (falsz > prawda && falsz >= 1) return 'wysokie';
  if (brak >= 3 && prawda === 0 && KATEGORIE_WYSOKIEGO_RYZYKA.has(klaster.kategoria)) return 'wysokie';
  if (prawda > falsz + brak && prawda >= 2) return 'niskie';
  return 'srednie';
}

/**
 * Ocenia deterministycznie na podstawie statystyk z bazy, czy klaster wykazuje nadaktywność.
 */
function ocenNadaktywnosc(klaster, statystyki, opcjeProgow = {}) {
  const p = pobierzProgi(opcjeProgow);
  const dzis = Number(statystyki.liczba_dzis || 0);
  const godzina = Number(statystyki.liczba_godzina || 0);
  const bazaTlo = Number(statystyki.srednia_dzienna_tlo || 0);
  const udzial = Number(statystyki.udzial_dzis || 0);
  const ruchDzis = Number(statystyki.ruch_dzis_lacznie || 0);

  const wskaznikWzrostu = bazaTlo > 0
    ? Number((dzis / bazaTlo).toFixed(2))
    : Number(Math.max(1, godzina > 0 ? godzina / 1.5 : 1).toFixed(2));

  const powody = [];
  let poziom = null;

  if (godzina >= p.PROG_KRYTYCZNY_GODZINA || dzis >= p.PROG_KRYTYCZNY_DZIEN) {
    poziom = 'krytyczna';
    powody.push(`krytyczny skok wolumenu (${dzis} dzisiaj, ${godzina} w ostatniej godzinie)`);
  } else if (
    godzina >= p.PROG_WYSOKI_GODZINA ||
    dzis >= p.PROG_WYSOKI_DZIEN ||
    (bazaTlo >= 1 && dzis >= 10 && wskaznikWzrostu >= 5)
  ) {
    poziom = 'wysoka';
    powody.push(`wysoka nadaktywność zapytań (${dzis} dzisiaj, ${godzina} w ostatniej godzinie)`);
  } else {
    if (godzina >= p.PROG_GODZINA) {
      poziom = 'podwyzszona';
      powody.push(`${godzina} zapytań w ostatniej godzinie (próg ${p.PROG_GODZINA}/h)`);
    }
    if (dzis >= p.PROG_DZIEN) {
      poziom = 'podwyzszona';
      powody.push(`${dzis} zapytań dzisiaj (próg ${p.PROG_DZIEN}/dzień)`);
    }
    if (ruchDzis >= 10 && dzis >= p.MIN_DO_UDZIALU && udzial >= p.PROG_UDZIAL_DZIEN) {
      poziom = 'podwyzszona';
      powody.push(`temat stanowi ${Math.round(udzial * 100)}% dzisiejszego ruchu (${dzis}/${ruchDzis})`);
    }
    if (bazaTlo >= 1 && dzis >= 5 && wskaznikWzrostu >= p.MNOZNIK_SKOKU) {
      poziom = 'podwyzszona';
      powody.push(`wzrost ×${wskaznikWzrostu} względem średniej z poprzednich dni (${bazaTlo}/dzień)`);
    }
  }

  return {
    czyAlert: poziom !== null,
    poziom,
    wskaznikWzrostu,
    ryzykoDezinformacji: ocenaRyzykaZStatystyk(klaster, statystyki),
    powodWykrycia: powody.length
      ? `Wykryto nadaktywność: ${powody.join('; ')}.`
      : 'Ruch w normie.',
  };
}

function zbudujNaglowekAlertu(klaster, statystyki) {
  const czescGodzinna = statystyki.liczba_godzina > 0 ? `, ${statystyki.liczba_godzina} w ostatniej godz.` : '';
  return `Wzmożone zapytania: ${klaster.tytul} (${statystyki.liczba_dzis} dzisiaj${czescGodzinna})`;
}

function opisRozkladuWerdyktow(rozklad) {
  const wpisy = Object.entries(rozklad || {})
    .filter(([, ile]) => ile > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!wpisy.length) return 'brak zakończonych weryfikacji';
  return wpisy.map(([nazwa, ile]) => `${nazwa}: ${ile}`).join(', ');
}

function bezpiecznePodsumowanieSzablonowe(klaster, statystyki, ocena) {
  const opisWerdyktow = opisRozkladuWerdyktow(statystyki.rozklad_werdyktow);
  const warianty = (statystyki.przyklady || []).slice(0, 3).map((p) => `„${p.tekst}”`).join(', ');
  const ryzyko = ocena.ryzykoDezinformacji;

  const obawy = [klaster.kategoria !== 'inne' ? klaster.kategoria.replace(/_/g, ' ') : 'weryfikacja doniesień'];
  if (ryzyko === 'wysokie') obawy.push('możliwy niepokój lub fala pogłosek');

  const rekomendacja =
    ryzyko === 'wysokie'
      ? 'Zalecane sprawdzenie najnowszych komunikatów właściwych instytucji (np. RCB, MON, resortów) i opublikowanie jasnego komunikatu dementującego lub wyjaśniającego.'
      : 'Zalecane dalsze monitorowanie dynamiki pytań oraz uzupełnienie źródeł w bazie KOMA.';

  return {
    naglowekAlertu: zbudujNaglowekAlertu(klaster, statystyki),
    podsumowanieSytuacyjne:
      `Dzisiaj odnotowano ${statystyki.liczba_dzis} zgłoszeń (${statystyki.liczba_godzina} w ostatniej godzinie) dotyczących tematu „${klaster.tytul}”` +
      (warianty ? `, m.in. zapytań: ${warianty}` : '') +
      `. Dotychczasowy bilans weryfikacji KOMA: ${opisWerdyktow}. ` +
      `Statystyka odzwierciedla wyłącznie liczbę i treść pytań kierowanych przez użytkowników i nie stanowi potwierdzenia opisywanych zdarzeń.`,
    obawySpoleczne: obawy,
    rekomendacjaKomunikacyjna: rekomendacja,
    ocenaRyzykaDezinformacji: ryzyko,
    metodaPodsumowania: 'szablon_bezpieczny',
  };
}

async function generujPodsumowanieAlertu(klaster, statystyki, ocena, options = {}) {
  const szablon = bezpiecznePodsumowanieSzablonowe(klaster, statystyki, ocena);
  const uzyjLlm = options.useLlm !== false && process.env.KOMA_MONITORING_LLM !== '0';
  if (!uzyjLlm) return szablon;

  try {
    const statystykiWejscie = {
      temat_klastra: klaster.tytul,
      kanoniczne_pytanie: klaster.kanoniczne_pytanie,
      kategoria: klaster.kategoria,
      data_dnia: statystyki.data_dnia,
      liczba_zgloszen_dzis: statystyki.liczba_dzis,
      liczba_zgloszen_ostatnia_godzina: statystyki.liczba_godzina,
      liczba_zgloszen_lacznie: statystyki.liczba_calkowita,
      srednia_dzienna_poprzednich_dni: statystyki.srednia_dzienna_tlo,
      wskaznik_wzrostu: ocena.wskaznikWzrostu,
      rozklad_werdyktow_koma: statystyki.rozklad_werdyktow,
    };
    const przyklady = (statystyki.przyklady || []).slice(0, 10).map((p) => ({
      tresc: String(p.tekst).slice(0, 240),
      liczba: p.liczba,
      werdykt: p.werdykt_ogolny || 'w trakcie analizy',
    }));

    const odp = await zapytajModelJson({
      system: PROMPT_PODSUMOWANIA,
      user: [
        `<STATYSTYKI_Z_BAZY>\n${JSON.stringify(statystykiWejscie, null, 1)}\n</STATYSTYKI_Z_BAZY>`,
        `<PRZYKLADOWE_ZGLOSZENIA>\n${JSON.stringify(przyklady, null, 1)}\n</PRZYKLADOWE_ZGLOSZENIA>`,
      ].join('\n'),
      ...ZADANIA.podsumowanieAlertu,
      model: options.model || ZADANIA.podsumowanieAlertu.model,
      timeoutMs: options.timeoutMs || ZADANIA.podsumowanieAlertu.timeoutMs,
      proby: options.proby ?? ZADANIA.podsumowanieAlertu.proby,
      ollamaUrl: options.ollamaUrl,
      fetchImpl: options.fetchImpl,
    });

    const podsumowanie = wyczyscBialeZnaki(odp?.podsumowanie_sytuacyjne || '').slice(0, 900);
    if (podsumowanie.length < 30) return szablon;

    const obawy = (Array.isArray(odp?.obawy_spoleczne) ? odp.obawy_spoleczne : [])
      .map((x) => wyczyscBialeZnaki(String(x || '')).slice(0, 80))
      .filter(Boolean)
      .slice(0, 5);
    const rekomendacja = wyczyscBialeZnaki(odp?.rekomendacja_komunikacyjna || '').slice(0, 450) || szablon.rekomendacjaKomunikacyjna;

    // Model nie może obniżyć wysokiego ryzyka wyliczonego z faktów (np. przewagi werdyktów "Fałszywe")
    const ryzykoModelu = ['niskie', 'srednie', 'wysokie'].includes(odp?.ocena_ryzyka_dezinformacji)
      ? odp.ocena_ryzyka_dezinformacji
      : ocena.ryzykoDezinformacji;
    const ocenaRyzyka = ocena.ryzykoDezinformacji === 'wysokie' ? 'wysokie' : ryzykoModelu;

    return {
      naglowekAlertu: szablon.naglowekAlertu, // zawsze z twardymi liczbami z bazy
      podsumowanieSytuacyjne: podsumowanie,
      obawySpoleczne: obawy.length ? obawy : szablon.obawySpoleczne,
      rekomendacjaKomunikacyjna: rekomendacja,
      ocenaRyzykaDezinformacji: ocenaRyzyka,
      metodaPodsumowania: 'model_llm',
    };
  } catch (err) {
    if (!options.cichyLog) {
      console.warn(`[KOMA monitoring] Model podsumowania alertu niedostępny (${err.message}) – użyto bezpiecznego szablonu.`);
    }
    return szablon;
  }
}

function czyOdswiezycPodsumowanie(istniejacyAlert, statystyki, ocena, teraz, cooldownMs) {
  if (!istniejacyAlert) return true;
  if ((RANGA_POZIOMU[ocena.poziom] || 0) > (RANGA_POZIOMU[istniejacyAlert.poziom] || 0)) return true;
  if (ocena.ryzykoDezinformacji === 'wysokie' && istniejacyAlert.ocena_ryzyka_dezinformacji !== 'wysokie') return true;

  const poprzednia = Number(istniejacyAlert.ostatnia_liczba_przy_podsumowaniu || 0);
  const biezaca = Number(statystyki.liczba_calkowita || 0);
  const przyrost = biezaca - poprzednia;
  if (przyrost <= 0) return false;

  const uplynelo = teraz.getTime() - new Date(istniejacyAlert.zaktualizowano_at).getTime();
  const istotnySkok = przyrost >= 5 || przyrost >= Math.ceil(poprzednia * 0.25);
  return istotnySkok && uplynelo >= cooldownMs;
}

/**
 * Przegląda aktywne klastry i tworzy/aktualizuje alerty nadaktywności w bazie.
 */
async function sprawdzNadaktywnosc(baza, options = {}) {
  const teraz = options.teraz instanceof Date ? options.teraz : new Date(options.teraz || Date.now());
  const cooldownMs = options.cooldownMs ?? ustawienia.MONITORING_COOLDOWN_PODSUMOWANIA_MS;
  const klastry = baza.pobierzAktywneKlastryDoDetekcji(teraz);
  const przetworzoneAlerty = [];

  for (const klaster of klastry) {
    const statystyki = baza.pobierzStatystykiKlastra(klaster.id, teraz);
    const ocena = ocenNadaktywnosc(klaster, statystyki, options.progi);
    const istniejacy = baza.pobierzAlertDlaKlastra(klaster.id);

    if (!ocena.czyAlert && !istniejacy) continue;

    if (!ocena.czyAlert && istniejacy) {
      // Odświeżamy liczniki na istniejącym alercie (np. gdy kończy się dzień albo zmieniły się werdykty)
      baza.aktualizujLicznikiAlertu(klaster.id, {
        poziom: istniejacy.poziom,
        powodWykrycia: istniejacy.powod_wykrycia,
        statystyki,
        wskaznikWzrostu: ocena.wskaznikWzrostu,
        naglowekAlertu: istniejacy.naglowek_alertu,
        teraz,
      });
      continue;
    }

    const odswiezyc = options.wymusPodsumowanie === true ||
      czyOdswiezycPodsumowanie(istniejacy, statystyki, ocena, teraz, cooldownMs);

    if (odswiezyc) {
      const tresc = await generujPodsumowanieAlertu(klaster, statystyki, ocena, options);
      const alert = baza.zapiszLubAktualizujAlert({
        klasterId: klaster.id,
        poziom: ocena.poziom,
        powodWykrycia: ocena.powodWykrycia,
        liczbaDzis: statystyki.liczba_dzis,
        liczbaGodzina: statystyki.liczba_godzina,
        liczbaCalkowita: statystyki.liczba_calkowita,
        wskaznikWzrostu: ocena.wskaznikWzrostu,
        rozkladWerdyktow: statystyki.rozklad_werdyktow,
        naglowekAlertu: tresc.naglowekAlertu,
        podsumowanieSytuacyjne: tresc.podsumowanieSytuacyjne,
        obawySpoleczne: tresc.obawySpoleczne,
        rekomendacjaKomunikacyjna: tresc.rekomendacjaKomunikacyjna,
        ocenaRyzykaDezinformacji: tresc.ocenaRyzykaDezinformacji,
        metodaPodsumowania: tresc.metodaPodsumowania,
        liczbaPrzyPodsumowaniu: statystyki.liczba_calkowita,
        teraz,
      });
      przetworzoneAlerty.push(alert);
    } else {
      baza.aktualizujLicznikiAlertu(klaster.id, {
        poziom: ocena.poziom,
        powodWykrycia: ocena.powodWykrycia,
        statystyki,
        wskaznikWzrostu: ocena.wskaznikWzrostu,
        naglowekAlertu: zbudujNaglowekAlertu(klaster, statystyki),
        teraz,
      });
    }
  }

  return przetworzoneAlerty;
}

module.exports = {
  ocenNadaktywnosc,
  generujPodsumowanieAlertu,
  bezpiecznePodsumowanieSzablonowe,
  sprawdzNadaktywnosc,
  zbudujNaglowekAlertu,
  pobierzProgi,
};
