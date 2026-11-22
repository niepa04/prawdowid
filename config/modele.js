// config/modele.js - MODELE AI używane przez Komę i ich parametry.
//
// Wszystkie modele działają na serwerze Ollama. Zmienne środowiskowe (plik .env) mają pierwszeństwo,
// więc model albo adres serwera można zmienić bez edycji kodu.
//
// Role modeli:
//   ocr       - odczyt tekstu ze zdjęć i zrzutów ekranu (model wizyjny)
//   filtr     - filtr tematu (Model 1) i filtr wstępny zgłoszeń
//   analiza   - Research Gatherer (plan, notatka) i Weryfikator Prawdy

const env = process.env;

// Adres serwera Ollama (bez końcówki /api/...)
const OLLAMA_URL = String(env.OLLAMA_URL || env.OCR_URL || 'http://100.127.211.111:11434')
  .trim()
  .replace(/\/api\/(generate|chat)\/?$/i, '')
  .replace(/\/+$/, '');

const MODELE = {
  ocr: env.OCR_MODEL || 'glm-ocr:latest',
  filtr: env.FILTR_MODEL || 'qwen3.5:9b',
  analiza: env.KOMA_MODEL || env.OLLAMA_MODEL || 'qwen3.5:9b',
};

// Parametry dla każdego zadania: który model, rozmiar kontekstu (numCtx), maks. długość odpowiedzi
// (numPredict), limit czasu jednego zapytania i liczba prób.
const ZADANIA = {
  ocr: { model: MODELE.ocr, timeoutMs: Number(env.OLLAMA_TIMEOUT_MS) || 300000, proby: 3 },
  // Ollama domyślnie ucina długie wejście, a tekst ze stron bywa długi - stąd duży kontekst
  filtrTematu: { model: MODELE.filtr, numCtx: Number(env.FILTR_NUM_CTX) || 32768, timeoutMs: Number(env.OLLAMA_TIMEOUT_MS) || 300000, proby: 3 },
  filtrWstepny: { model: MODELE.filtr, numCtx: 4096, numPredict: 120, timeoutMs: 60000 },
  planResearchu: { model: MODELE.analiza, numCtx: 8192, numPredict: 500, timeoutMs: 120000 },
  notatkaResearchu: { model: MODELE.analiza, numCtx: 16384, numPredict: 1200, timeoutMs: 240000 },
  weryfikator: { model: MODELE.analiza, numCtx: 16384, numPredict: 2000, timeoutMs: 240000 },
  // Sędzia w testach jakości (tests/test_werdyktow.js)
  sedziaTestow: { model: MODELE.filtr, numCtx: 4096, numPredict: 80, timeoutMs: 60000 },
};

module.exports = { OLLAMA_URL, MODELE, ZADANIA };
