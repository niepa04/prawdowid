// config/ustawienia.js - LIMITY I CZASY działania Komy.
// Część z nich jest wstawiana do promptów (np. MAX_PYTAN), więc zmiana tutaj zmienia też prompt.
// Zmienne środowiskowe (plik .env) mają pierwszeństwo tam, gdzie są podane.

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
};
