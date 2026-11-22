// config/ustawienia.js - LIMITY I CZASY działania Komy.
// Część z nich jest wstawiana do promptów (np. MAX_PYTAN), więc zmiana tutaj zmienia też prompt.
// Zmienne środowiskowe (plik .env) mają pierwszeństwo tam, gdzie są podane.
const path = require('path');

module.exports = {
  // ---- Serwer ----
  // Port serwera (Express): strona Koma, API i rozszerzenie łączą się z tym portem
  PORT: Number(process.env.PORT) || 3000,
  // 0.0.0.0 = nasłuch na wszystkich interfejsach (także Tailscale); 127.0.0.1 = tylko lokalnie
  HOST: process.env.HOST || '0.0.0.0',
  // Górny limit czasu jednego sprawdzenia (potem odpowiedź 504)
  MAX_CZAS_SPRAWDZENIA_MS: Number(process.env.KOMA_MAX_CZAS_MS) || 8 * 60 * 1000,

  // ---- Ekstrakcja treści (Model 1) ----
  // Ile znaków treści artykułu z linku przekazujemy dalej
  MAX_ZNAKOW_ARTYKULU: 8000,

  // ---- Research Gatherer ----
  // Ile pytań badawczych (tez użytkownika) najwyżej planujemy
  MAX_PYTAN: 3,
  // Ile materiałów najwyżej trafia do notatki i weryfikatora
  MAX_MATERIALOW: 14,

  // ---- Weryfikator Prawdy ----
  // Ile tez z jednego zgłoszenia najwyżej oceniamy
  MAX_TEZ: 6,

  // ---- Monitoring promptów i system wczesnego ostrzegania (działa w tle) ----
  MONITORING_AKTYWNY: process.env.KOMA_MONITORING !== '0',
  MONITORING_DB_PATH: process.env.KOMA_MONITORING_DB || path.join(__dirname, '..', 'backend', 'dane', 'monitoring.sqlite'),
  MONITORING_STREFA_CZASOWA: process.env.KOMA_TIMEZONE || 'Europe/Warsaw',
  MONITORING_INTERWAL_MS: Number(process.env.KOMA_MONITORING_INTERWAL_MS) || 30000,
  // Progi wykrywania podejrzanej nadaktywności
  MONITORING_PROG_GODZINA: Number(process.env.KOMA_ALERT_PROG_GODZINA) || 5,
  MONITORING_PROG_DZIEN: Number(process.env.KOMA_ALERT_PROG_DZIEN) || 12,
  MONITORING_PROG_WYSOKI_GODZINA: Number(process.env.KOMA_ALERT_WYSOKI_GODZINA) || 20,
  MONITORING_PROG_WYSOKI_DZIEN: Number(process.env.KOMA_ALERT_WYSOKI_DZIEN) || 50,
  MONITORING_PROG_KRYTYCZNY_GODZINA: Number(process.env.KOMA_ALERT_KRYTYCZNY_GODZINA) || 50,
  MONITORING_PROG_KRYTYCZNY_DZIEN: Number(process.env.KOMA_ALERT_KRYTYCZNY_DZIEN) || 200,
  MONITORING_PROG_UDZIAL_DZIEN: Number(process.env.KOMA_ALERT_PROG_UDZIAL) || 0.35,
  MONITORING_MIN_DO_UDZIALU: Number(process.env.KOMA_ALERT_MIN_DO_UDZIALU) || 5,
  MONITORING_MNOZNIK_SKOKU: Number(process.env.KOMA_ALERT_MNOZNIK_SKOKU) || 3.0,
  MONITORING_COOLDOWN_PODSUMOWANIA_MS: Number(process.env.KOMA_ALERT_COOLDOWN_MS) || 60000,
  MONITORING_MAX_KLASTRY_KANDYDACI: 25,
};
