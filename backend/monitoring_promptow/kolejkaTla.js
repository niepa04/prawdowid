// kolejkaTla.js - asynchroniczna kolejka robocza w tle.
// Zgłoszenia są szybko zapisywane do bazy SQLite bez blokowania odpowiedzi HTTP,
// a semantyczne grupowanie i wykrywanie nadaktywności działają w tle w jednej kolejce.

const crypto = require('crypto');
const ustawienia = require('../../config/ustawienia');
const { utworzBazePromptow } = require('./bazaPromptow');
const { wyciagnijTrescDoMonitoringu } = require('./normalizacja');
const { pogrupujPrompt } = require('./grupowaniePromptow');
const { sprawdzNadaktywnosc } = require('./detektorNadaktywnosci');

function opoznienie(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

function utworzMonitoring(options = {}) {
  const aktywny = options.aktywny ?? ustawienia.MONITORING_AKTYWNY;
  if (!aktywny) {
    return {
      aktywny: false,
      rozpocznijWeryfikacje: () => {},
      zakonczWeryfikacje: () => {},
      zglosPrompt: () => null,
      aktualizujWynik: () => false,
      przetworzWszystkoTeraz: async () => ({ pogrupowane: 0, alerty: [] }),
      pobierzPanel: () => ({
        podsumowanie: {
          zgloszenia_lacznie: 0,
          zgloszenia_dzis: 0,
          zgloszenia_godzina: 0,
          oczekujace_w_tle: 0,
          aktywne_alerty: 0,
          liczba_klastrow: 0,
        },
        alerty: [],
        klastry: [],
        kolejka: { aktywny: false, pracuje: false, aktywne_weryfikacje: 0, oczekuje: 0, przetwarzany: 0, pogrupowany: 0, blad: 0 },
      }),
      pobierzSzczegoly: () => null,
      zmienStatusAlertu: () => null,
      statystykiKolejki: () => ({ aktywny: false, pracuje: false, aktywne_weryfikacje: 0 }),
      startujWorkerTla: () => {},
      zatrzymajWorkerTla: () => {},
      zamknij: () => {},
    };
  }

  const baza = utworzBazePromptow({
    sciezkaDb: options.sciezkaDb || ustawienia.MONITORING_DB_PATH,
    strefaCzasowa: options.strefaCzasowa || ustawienia.MONITORING_STREFA_CZASOWA,
  });
  baza.resetujUtknietePrzetwarzanie();

  const interwalMs = options.interwalMs ?? ustawienia.MONITORING_INTERWAL_MS;
  const maxUstapienieMs = options.maxUstapienieMs ?? 3000;

  let pracuje = false;
  let zamkniety = false;
  let wznowPrzetwarzanie = false;
  let odswiezWerdyktyAlertow = false;
  let timerInterwalu = null;
  let biezacyObietnicaPracy = null;
  let aktywneWeryfikacje = 0;

  const opcjeModeli = {
    useLlm: options.useLlm,
    model: options.model,
    ollamaUrl: options.ollamaUrl,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    proby: options.proby,
    progi: options.progi,
    cooldownMs: options.cooldownMs,
    cichyLog: options.cichyLog,
  };

  function rozpocznijWeryfikacje() {
    aktywneWeryfikacje++;
  }

  function zakonczWeryfikacje() {
    if (aktywneWeryfikacje > 0) aktywneWeryfikacje--;
    if (aktywneWeryfikacje === 0) wzbudzWorker();
  }

  async function czekajNaLuzWeryfikacji() {
    if (aktywneWeryfikacje <= 0 || maxUstapienieMs <= 0) return;
    const koniec = Date.now() + maxUstapienieMs;
    while (!zamkniety && aktywneWeryfikacje > 0 && Date.now() < koniec) {
      await opoznienie(150);
    }
  }

  async function wykonajCykl({ wymusBezUstapienia = false, wymusPodsumowanie = false, teraz = null } = {}) {
    let pogrupowane = 0;
    let brudne = false;

    while (!zamkniety) {
      const prompt = baza.pobierzNastepnyDoGrupowania();
      if (!prompt) break;

      try {
        // Szybki duplikat po hashu nie wymaga Ollamy, więc idzie natychmiast bez czekania na GPU
        const poHashu = baza.znajdzKlasterPoHashu(prompt.hash_tekstu);
        if (poHashu) {
          baza.przypiszDoIstniejacegoKlastra(prompt.id, poHashu.klasterId, {
            pewnosc: 1.0,
            metoda: 'dokladny_hash',
            teraz: teraz || new Date(),
          });
        } else {
          if (!wymusBezUstapienia) await czekajNaLuzWeryfikacji();
          if (zamkniety) {
            baza.resetujUtknietePrzetwarzanie();
            break;
          }
          await pogrupujPrompt(prompt, baza, {
            ...opcjeModeli,
            teraz: teraz || new Date(),
          });
        }
        pogrupowane++;
        brudne = true;
      } catch (err) {
        baza.oznaczBladGrupowania(prompt.id, err.message);
      }
    }

    let alerty = [];
    const trzebaSprawdzicAlerty = brudne || odswiezWerdyktyAlertow || wymusPodsumowanie;
    odswiezWerdyktyAlertow = false;
    if (!zamkniety && trzebaSprawdzicAlerty) {
      if (!wymusBezUstapienia) await czekajNaLuzWeryfikacji();
      if (!zamkniety) {
        alerty = await sprawdzNadaktywnosc(baza, {
          ...opcjeModeli,
          teraz: teraz || new Date(),
          wymusPodsumowanie,
        });
      }
    }
    return { pogrupowane, alerty };
  }

  function wzbudzWorker() {
    if (zamkniety) return;
    if (pracuje) {
      wznowPrzetwarzanie = true;
      return;
    }
    setImmediate(() => {
      if (zamkniety || pracuje) return;
      pracuje = true;
      biezacyObietnicaPracy = (async () => {
        try {
          do {
            wznowPrzetwarzanie = false;
            await wykonajCykl();
          } while (wznowPrzetwarzanie && !zamkniety);
        } catch (err) {
          if (!options.cichyLog) {
            console.error('[KOMA monitoring] Błąd workera tła:', err.message);
          }
        } finally {
          pracuje = false;
          biezacyObietnicaPracy = null;
        }
      })();
    });
  }

  /**
   * Zapisuje zgłoszenie w bazie (natychmiastowo) i zleca grupowanie w tle (bez await).
   */
  function zglosPrompt({ zewnetrzneId = null, tekst, statusWeryfikacji = 'w_trakcie', teraz = new Date() }) {
    if (zamkniety) return null;
    try {
      const idZgloszenia = zewnetrzneId || crypto.randomUUID();
      const { tekstOczyszczony, zrodloWejscia } = wyciagnijTrescDoMonitoringu(tekst);
      if (!tekstOczyszczony || tekstOczyszczony.length < 4) return null;

      const rekord = baza.zapiszPrompt({
        zewnetrzneId: idZgloszenia,
        tekstOczyszczony,
        zrodloWejscia,
        statusWeryfikacji,
        teraz,
      });
      if (!rekord) return null;
      wzbudzWorker();
      return { id: rekord.id, zewnetrzneId: idZgloszenia };
    } catch {
      // Monitoring tła nigdy nie może przerwać odpowiedzi dla użytkownika
      return null;
    }
  }

  function aktualizujWynik(zewnetrzneId, dane) {
    if (zamkniety || !zewnetrzneId) return false;
    try {
      const ok = baza.aktualizujWerdykt(zewnetrzneId, dane);
      if (ok && dane?.werdyktOgolny) {
        odswiezWerdyktyAlertow = true;
        wzbudzWorker();
      }
      return ok;
    } catch {
      return false;
    }
  }

  async function przetworzWszystkoTeraz(opcje = {}) {
    if (zamkniety) return { pogrupowane: 0, alerty: [] };
    if (biezacyObietnicaPracy) {
      await biezacyObietnicaPracy.catch(() => {});
    }
    return wykonajCykl({
      wymusBezUstapienia: true,
      wymusPodsumowanie: opcje.wymusPodsumowanie ?? true,
      teraz: opcje.teraz || null,
    });
  }

  function startujWorkerTla() {
    if (zamkniety || timerInterwalu) return;
    wzbudzWorker();
    timerInterwalu = setInterval(() => {
      if (!zamkniety) wzbudzWorker();
    }, Math.max(2000, interwalMs));
    if (typeof timerInterwalu.unref === 'function') timerInterwalu.unref();
  }

  function zatrzymajWorkerTla() {
    if (timerInterwalu) {
      clearInterval(timerInterwalu);
      timerInterwalu = null;
    }
  }

  function statystykiKolejki() {
    if (zamkniety) return { aktywny: false, pracuje: false, aktywne_weryfikacje: 0 };
    return {
      aktywny: true,
      pracuje,
      aktywne_weryfikacje: aktywneWeryfikacje,
      ...baza.statystykiKolejki(),
    };
  }

  function pobierzPanel(opcje = {}) {
    const panel = baza.pobierzPanelMonitoringu(opcje);
    return { ...panel, kolejka: statystykiKolejki() };
  }

  function pobierzSzczegoly(klasterId, teraz = new Date()) {
    return baza.pobierzSzczegolyKlastra(klasterId, teraz);
  }

  function zmienStatusAlertu(alertId, status) {
    return baza.zmienStatusAlertu(alertId, status);
  }

  async function zamknij() {
    if (zamkniety) return;
    zamkniety = true;
    zatrzymajWorkerTla();
    if (biezacyObietnicaPracy) {
      await biezacyObietnicaPracy.catch(() => {});
    }
    baza.zamknij();
  }

  return {
    aktywny: true,
    baza,
    rozpocznijWeryfikacje,
    zakonczWeryfikacje,
    zglosPrompt,
    aktualizujWynik,
    przetworzWszystkoTeraz,
    pobierzPanel,
    pobierzSzczegoly,
    zmienStatusAlertu,
    statystykiKolejki,
    startujWorkerTla,
    zatrzymajWorkerTla,
    zamknij,
  };
}

let domyslnaInstancja = null;

function pobierzDomyslnyMonitoring() {
  if (!domyslnaInstancja) {
    domyslnaInstancja = utworzMonitoring();
  }
  return domyslnaInstancja;
}

module.exports = { utworzMonitoring, pobierzDomyslnyMonitoring };
