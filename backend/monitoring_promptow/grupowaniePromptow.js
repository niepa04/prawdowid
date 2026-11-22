// grupowaniePromptow.js - semantyczne grupowanie zgłoszeń użytkowników w klastry tematyczne.
// Korzysta z modelu qwen3.5:9b (skonfigurowanego już w config/modele.js),
// z szybkim dopasowaniem po hashu dla duplikatów oraz bezpieczną heurystyką awaryjną.

const { zapytajModelJson } = require('../wspolne/ollama');
const { ZADANIA } = require('../../config/modele');
const ustawienia = require('../../config/ustawienia');
const PROMPT_GRUPOWANIA = require('../../config/prompty/grupowaniePromptow');
const {
  podobienstwoSlowne,
  tokenyIRdzenie,
  wyczyscBialeZnaki,
} = require('./normalizacja');

const KATEGORIE_KLASTROW = new Set([
  'bezpieczenstwo_militarne',
  'zagrozenia_kryzysowe',
  'cyberbezpieczenstwo',
  'zdrowie',
  'infrastruktura_transport',
  'gospodarka_finanse',
  'polityka_dezinformacja',
  'inne',
]);

function wybierzKandydatow(tekst, wszystkieKlastry, maxKandydatow = 25) {
  if (!wszystkieKlastry.length) return [];
  const ocenione = wszystkieKlastry.map((k) => ({
    klaster: k,
    ...podobienstwoSlowne(tekst, k),
  }));

  const wybrane = new Map();
  // 1. Najbardziej podobne leksykalnie / po rdzeniach
  for (const x of [...ocenione].sort((a, b) => b.wynik - a.wynik || b.klaster.liczba_zgloszen - a.klaster.liczba_zgloszen)) {
    if (x.wynik <= 0) break;
    wybrane.set(x.klaster.id, x.klaster);
    if (wybrane.size >= Math.ceil(maxKandydatow * 0.6)) break;
  }
  // 2. Najświeższe i najpopularniejsze klastry (dla dopasowań czysto semantycznych bez wspólnych słów)
  for (const k of wszystkieKlastry) {
    if (wybrane.size >= maxKandydatow) break;
    if (!wybrane.has(k.id)) wybrane.set(k.id, k);
  }
  return [...wybrane.values()];
}

function zbudujDomyslnyKlaster(tekst, tematResearchu = null) {
  const czysty = wyczyscBialeZnaki(tekst);
  const bazowyTytul = tematResearchu && tematResearchu.length >= 8
    ? wyczyscBialeZnaki(tematResearchu).slice(0, 90)
    : czysty.slice(0, 90);
  const pytanie = czysty.endsWith('?')
    ? czysty.slice(0, 180)
    : `Zgłoszenie dotyczące tematu: ${bazowyTytul}`.slice(0, 180);
  const { slowa } = tokenyIRdzenie(czysty);
  return {
    tytul: bazowyTytul || 'Nowy temat zgłoszeń',
    kanonicznePytanie: pytanie,
    kategoria: 'inne',
    slowaKluczowe: [...slowa].slice(0, 8),
  };
}

function dopasujHeurystycznie(tekst, kandydaci) {
  let najlepszy = null;
  const liczbaRdzeniTekstu = tokenyIRdzenie(tekst).rdzenie.size;
  for (const k of kandydaci) {
    const ocena = podobienstwoSlowne(tekst, k);
    if (!najlepszy || ocena.wynik > najlepszy.wynik) {
      najlepszy = { klaster: k, ...ocena };
    }
  }
  const minWspolne = liczbaRdzeniTekstu <= 3 ? 1 : 2;
  const prog = liczbaRdzeniTekstu <= 3 ? 0.48 : 0.4;
  if (najlepszy && najlepszy.wspolneRdzenie >= minWspolne && najlepszy.wynik >= prog) {
    return {
      klasterId: najlepszy.klaster.id,
      pewnosc: Number(Math.min(0.89, 0.55 + najlepszy.wynik * 0.35).toFixed(2)),
    };
  }
  return null;
}

function parsujSlowaKluczowe(raw, tekst) {
  const zModelu = (Array.isArray(raw) ? raw : [])
    .map((s) => wyczyscBialeZnaki(String(s || '')))
    .filter((s) => s.length >= 2 && s.length <= 40 && s.split(/\s+/).length <= 3);
  if (zModelu.length > 0) return [...new Set(zModelu)].slice(0, 8);
  return [...tokenyIRdzenie(tekst).slowa].slice(0, 8);
}

/**
 * Grupuje jeden rekord promptu (zapisany w bazie) do istniejącego lub nowego klastra.
 * Działa poza ścieżką odpowiedzi użytkownika.
 */
async function pogrupujPrompt(prompt, baza, options = {}) {
  const teraz = options.teraz || new Date();

  // 1. Szybka ścieżka O(1): identyczny znormalizowany tekst był już pogrupowany
  const poHashu = baza.znajdzKlasterPoHashu(prompt.hash_tekstu);
  if (poHashu) {
    baza.przypiszDoIstniejacegoKlastra(prompt.id, poHashu.klasterId, {
      pewnosc: 1.0,
      metoda: 'dokladny_hash',
      teraz,
    });
    return { klasterId: poHashu.klasterId, metoda: 'dokladny_hash', nowy: false };
  }

  const wszystkieKlastry = baza.pobierzKlastryKandydatow(100);
  const kandydaci = wybierzKandydatow(
    prompt.tekst_oczyszczony,
    wszystkieKlastry,
    options.maxKandydatow || ustawienia.MONITORING_MAX_KLASTRY_KANDYDACI
  );
  const dozwoloneId = new Set(kandydaci.map((k) => k.id));

  const uzyjLlm = options.useLlm !== false && process.env.KOMA_MONITORING_LLM !== '0';

  // 2. Klasyfikacja semantyczna modelem qwen3.5:9b
  if (uzyjLlm) {
    try {
      const listaKlastrow = kandydaci.map((k) => ({
        id: k.id,
        tytul: k.tytul,
        kanoniczne_pytanie: k.kanoniczne_pytanie,
        slowa_kluczowe: (k.slowa_kluczowe || []).slice(0, 6),
      }));

      const userPrompt = [
        `<ZGLOSZENIE>\n${String(prompt.tekst_oczyszczony).slice(0, 1200)}\n</ZGLOSZENIE>`,
        prompt.temat_researchu ? `<KONTEKST_TEMATU>${wyczyscBialeZnaki(prompt.temat_researchu)}</KONTEKST_TEMATU>` : null,
        `<KLASTRY>\n${JSON.stringify(listaKlastrow)}\n</KLASTRY>`,
      ].filter(Boolean).join('\n');

      const odp = await zapytajModelJson({
        system: PROMPT_GRUPOWANIA,
        user: userPrompt,
        ...ZADANIA.grupowaniePromptow,
        model: options.model || ZADANIA.grupowaniePromptow.model,
        timeoutMs: options.timeoutMs || ZADANIA.grupowaniePromptow.timeoutMs,
        proby: options.proby ?? ZADANIA.grupowaniePromptow.proby,
        ollamaUrl: options.ollamaUrl,
        fetchImpl: options.fetchImpl,
      });

      const pewnosc = Math.max(0, Math.min(1, Number(odp?.pewnosc ?? 0.85) || 0.85));
      const kandydatId = odp?.klaster_id != null ? Number(odp.klaster_id) : null;

      if (odp?.decyzja === 'istniejacy' && kandydatId && dozwoloneId.has(kandydatId) && pewnosc >= 0.55) {
        baza.przypiszDoIstniejacegoKlastra(prompt.id, kandydatId, {
          pewnosc: Number(pewnosc.toFixed(2)),
          metoda: 'model_llm',
          teraz,
        });
        return { klasterId: kandydatId, metoda: 'model_llm', nowy: false };
      }

      if (odp?.decyzja === 'nowy' || !kandydaci.length) {
        const nk = odp?.nowy_klaster || {};
        const domyslny = zbudujDomyslnyKlaster(prompt.tekst_oczyszczony, prompt.temat_researchu);
        const tytul = wyczyscBialeZnaki(nk.tytul || '').slice(0, 100) || domyslny.tytul;
        const pytanie = wyczyscBialeZnaki(nk.kanoniczne_pytanie || '').slice(0, 200) || domyslny.kanonicznePytanie;
        const kategoria = KATEGORIE_KLASTROW.has(nk.kategoria) ? nk.kategoria : 'inne';
        const slowaKluczowe = parsujSlowaKluczowe(nk.slowa_kluczowe, prompt.tekst_oczyszczony);

        const nowyId = baza.utworzKlasterIPrzypisz(prompt.id, {
          tytul,
          kanonicznePytanie: pytanie,
          kategoria,
          slowaKluczowe,
          pewnosc: Number(pewnosc.toFixed(2)),
          metoda: 'model_llm',
          teraz,
        });
        return { klasterId: nowyId, metoda: 'model_llm', nowy: true };
      }
    } catch (err) {
      // Awaria/timeout modelu w tle nie może zatrzymać kolejki - przechodzimy do bezpiecznej heurystyki
      if (!options.cichyLog) {
        console.warn(`[KOMA monitoring] Model grupowania niedostępny (${err.message}) – użyto dopasowania heurystycznego.`);
      }
    }
  }

  // 3. Tryb awaryjny / bez LLM: dopasowanie leksykalne po rdzeniach i synonimach
  const trafienie = dopasujHeurystycznie(prompt.tekst_oczyszczony, kandydaci);
  if (trafienie) {
    baza.przypiszDoIstniejacegoKlastra(prompt.id, trafienie.klasterId, {
      pewnosc: trafienie.pewnosc,
      metoda: 'heurystyka',
      teraz,
    });
    return { klasterId: trafienie.klasterId, metoda: 'heurystyka', nowy: false };
  }

  const domyslny = zbudujDomyslnyKlaster(prompt.tekst_oczyszczony, prompt.temat_researchu);
  const nowyId = baza.utworzKlasterIPrzypisz(prompt.id, {
    ...domyslny,
    pewnosc: 1.0,
    metoda: 'nowy_klaster',
    teraz,
  });
  return { klasterId: nowyId, metoda: 'nowy_klaster', nowy: true };
}

module.exports = {
  pogrupujPrompt,
  wybierzKandydatow,
  dopasujHeurystycznie,
  zbudujDomyslnyKlaster,
  KATEGORIE_KLASTROW,
};
