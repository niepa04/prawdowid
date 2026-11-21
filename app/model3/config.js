// config.js - Konfiguracja Modelu 3 (KOMA / PRAWDOWID)
const path = require('node:path');

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
    ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    ollamaModel: process.env.MODEL3_OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'qwen3.5:9b',
    timeoutMs: parsePositiveInt(process.env.MODEL3_TIMEOUT_MS, 15000),
    maxQueries: parsePositiveInt(process.env.MODEL3_MAX_QUERIES, 5),
    maxRounds: parsePositiveInt(process.env.MODEL3_MAX_ROUNDS, 3),
    maxConcurrency: parsePositiveInt(process.env.MODEL3_MAX_CONCURRENCY, 4),
    maxDocumentSize: parsePositiveInt(process.env.MODEL3_MAX_DOCUMENT_SIZE, 2 * 1024 * 1024), // 2 MB
    maxRedirects: parsePositiveInt(process.env.MODEL3_MAX_REDIRECTS, 5),
    maxSubpagesPerSource: parsePositiveInt(process.env.MODEL3_MAX_SUBPAGES_PER_SOURCE, 4),
    maxSourcesPerClaim: parsePositiveInt(process.env.MODEL3_MAX_SOURCES_PER_CLAIM, 6),
    staleWarningAgeDays: parsePositiveInt(process.env.MODEL3_STALE_WARNING_AGE_DAYS, 14),
    staleMeasurementAgeHours: parsePositiveInt(process.env.MODEL3_STALE_MEASUREMENT_AGE_HOURS, 24),
    sourceRegistryPath:
      process.env.MODEL3_SOURCE_REGISTRY_PATH ||
      path.join(__dirname, 'data', 'koma_zrodla_oficjalne.json'),
    sourceMapPath:
      process.env.MODEL3_SOURCE_MAP_PATH ||
      path.join(__dirname, 'data', 'source_map.json'),
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
