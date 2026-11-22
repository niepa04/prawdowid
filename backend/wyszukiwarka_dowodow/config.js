// config.js - ustawienia wyszukiwarki dowodów (limity pobierania, źródła).
// Pliki źródeł i model biorą się z głównego folderu config/ (config/zrodla, config/modele.js).
const konfiguracja = require('../../config');

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function getConfig(overrides = {}) {
  const defaults = {
    ollamaUrl: konfiguracja.modele.OLLAMA_URL,
    ollamaModel: process.env.MODEL3_OLLAMA_MODEL || konfiguracja.modele.MODELE.analiza,
    timeoutMs: parsePositiveInt(process.env.MODEL3_TIMEOUT_MS, 15000),
    maxQueries: parsePositiveInt(process.env.MODEL3_MAX_QUERIES, 5),
    maxRounds: parsePositiveInt(process.env.MODEL3_MAX_ROUNDS, 3),
    maxConcurrency: parsePositiveInt(process.env.MODEL3_MAX_CONCURRENCY, 4),
    maxDocumentSize: parsePositiveInt(process.env.MODEL3_MAX_DOCUMENT_SIZE, 2 * 1024 * 1024), // 2 MB
    maxRedirects: parsePositiveInt(process.env.MODEL3_MAX_REDIRECTS, 5),
    maxSubpagesPerSource: parsePositiveInt(process.env.MODEL3_MAX_SUBPAGES_PER_SOURCE, 4), // na jeden poziom
    // Jak głęboko schodzić po linkach w zaufanych źródłach (1 = tylko linki ze strony wejściowej)
    maxCrawlDepth: parsePositiveInt(process.env.MODEL3_MAX_CRAWL_DEPTH, 2),
    // Łączny limit podstron pobieranych z jednego źródła (wszystkie poziomy razem)
    maxPagesPerSource: parsePositiveInt(process.env.MODEL3_MAX_PAGES_PER_SOURCE, 10),
    // Ogólne kanały, w których pojawiłoby się każde poważne zdarzenie w Polsce (KPRM, RCB, MON,
    // ogólnopolski system ostrzeżeń). Przeszukiwane, gdy do twierdzenia nie pasuje żadne źródło tematyczne.
    fallbackSourceIds: (process.env.MODEL3_FALLBACK_SOURCES || 'SRC040,SRC037,SRC009,SRC002').split(',').map((s) => s.trim()).filter(Boolean),
    // Przeglądanie Demagoga: ile artykułów otworzyć na twierdzenie (znalezionych przez bazę Google)
    maxDemagogArticles: parsePositiveInt(process.env.MODEL3_MAX_DEMAGOG_ARTICLES, 2),
    maxSourcesPerClaim: parsePositiveInt(process.env.MODEL3_MAX_SOURCES_PER_CLAIM, 6),
    staleWarningAgeDays: parsePositiveInt(process.env.MODEL3_STALE_WARNING_AGE_DAYS, 14),
    staleMeasurementAgeHours: parsePositiveInt(process.env.MODEL3_STALE_MEASUREMENT_AGE_HOURS, 24),
    // Katalog zaufanych źródeł i mapa tematów: config/zrodla/
    sourceRegistryPath: process.env.MODEL3_SOURCE_REGISTRY_PATH || konfiguracja.zrodla.sciezkaZrodelOficjalnych,
    sourceMapPath: process.env.MODEL3_SOURCE_MAP_PATH || konfiguracja.zrodla.sciezkaMapyTematow,
    // Klucz do Google Fact Check Tools API (oceny polskich fact-checkerów); bez niego ten krok jest pomijany
    factCheckApiKey: process.env.GOOGLE_FACTCHECK_API_KEY || null,
    strictTrustedSources: parseBoolean(process.env.MODEL3_STRICT_TRUSTED_SOURCES, true),
    userAgent:
      process.env.MODEL3_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  };

  return {
    ...defaults,
    ...overrides,
  };
}

module.exports = {
  getConfig,
  parsePositiveInt,
  parseBoolean,
};
