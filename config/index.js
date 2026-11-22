// config/index.js - jedno miejsce na wszystkie wymienne części Komy.
//
//   config/modele.js                  modele AI (Ollama), ich role i parametry
//   config/ustawienia.js              limity i czasy (port, max. czas sprawdzenia, liczba tez...)
//   config/prompty/*.js               prompty systemowe wszystkich modeli
//   config/zrodla/zrodla_oficjalne.json   katalog zaufanych źródeł (domeny, tematy, adresy wejściowe)
//   config/zrodla/mapa_tematow.json       tematy -> źródła (wybór źródeł do twierdzenia)
//   config/zrodla/fact_checkerzy.json     zaufani fact-checkerzy i Google Fact Check Tools API
//
// Szczegóły: docs/konfiguracja.md

const path = require('path');

module.exports = {
  modele: require('./modele'),
  ustawienia: require('./ustawienia'),
  zrodla: {
    sciezkaZrodelOficjalnych: path.join(__dirname, 'zrodla', 'zrodla_oficjalne.json'),
    sciezkaMapyTematow: path.join(__dirname, 'zrodla', 'mapa_tematow.json'),
    factCheckerzy: require('./zrodla/fact_checkerzy.json'),
    // teksty strony "Zaufane źródła": kategorie, opis Fact Check API, wymagania dla nowych źródeł
    kryteria: require('./zrodla/kryteria_zrodel.json'),
  },
  prompty: {
    ocr: require('./prompty/ocr'),
    filtrTematu: require('./prompty/filtrTematu'),
    filtrWstepny: require('./prompty/filtrWstepny'),
    researchPlan: require('./prompty/researchPlan'),
    researchNotatka: require('./prompty/researchNotatka'),
    weryfikator: require('./prompty/weryfikator'),
    sedziaTestow: require('./prompty/sedziaTestow'),
  },
};
