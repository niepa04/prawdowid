// index.js - publiczne API komponentu monitoringu i alarmowania w tle.

const { utworzMonitoring, pobierzDomyslnyMonitoring } = require('./kolejkaTla');
const { utworzBazePromptow, STATUSY_ALERTU, POZIOMY_ALERTU } = require('./bazaPromptow');
const { pogrupujPrompt, KATEGORIE_KLASTROW } = require('./grupowaniePromptow');
const { ocenNadaktywnosc, sprawdzNadaktywnosc } = require('./detektorNadaktywnosci');

module.exports = {
  utworzMonitoring,
  pobierzDomyslnyMonitoring,
  utworzBazePromptow,
  pogrupujPrompt,
  ocenNadaktywnosc,
  sprawdzNadaktywnosc,
  STATUSY_ALERTU,
  POZIOMY_ALERTU,
  KATEGORIE_KLASTROW,
};
