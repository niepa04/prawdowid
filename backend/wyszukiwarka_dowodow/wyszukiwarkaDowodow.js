// model3.js - Główny moduł Modelu 3 (KOMA / PRAWDOWID) – zbieranie dowodów z katalogu 40 oficjalnych źródeł
const { getConfig } = require('./config');
const { createSourceRegistry, SourceRegistryError } = require('./sourceRegistry');
const { createSourceFetcher } = require('./sourceFetcher');
const { createSearchProvider } = require('./providers/searchProvider');
const { collectEvidenceForClaim } = require('./evidenceCollector');
const { validateModel3Output, EvidenceValidationError } = require('./validators/evidenceValidator');

class Model3Error extends Error {
  constructor(message, code = 'MODEL3_ERROR', cause = null) {
    super(message);
    this.name = 'Model3Error';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * Normalizuje i waliduje wejście z Modelu 2 ({ original_text, claims: [...] }).
 */
function normalizeModel2Input(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Model3Error('Wejście do Modelu 3 musi być obiektem zwróconym przez Model 2.', 'INVALID_INPUT');
  }
  if (!Array.isArray(input.claims)) {
    throw new Model3Error('Wejście do Modelu 3 musi zawierać tablicę "claims".', 'INVALID_INPUT');
  }

  const normalizedClaims = input.claims.map((c, idx) => {
    if (!c || typeof c !== 'object') {
      throw new Model3Error(`Twierdzenie nr ${idx + 1} musi być obiektem.`, 'INVALID_INPUT');
    }
    const id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : typeof c.claim_id === 'string' && c.claim_id.trim() ? c.claim_id.trim() : null;
    if (!id) {
      throw new Model3Error(`Twierdzenie nr ${idx + 1} nie posiada pola "id".`, 'INVALID_INPUT');
    }
    if (typeof c.claim !== 'string' || c.claim.trim().length === 0) {
      throw new Model3Error(`Twierdzenie "${id}" nie posiada niepustego pola "claim".`, 'INVALID_INPUT');
    }
    return {
      ...c,
      id,
      claim: c.claim.trim(),
      related_to: Array.isArray(c.related_to) ? c.related_to : [],
    };
  });

  return {
    original_text: typeof input.original_text === 'string' ? input.original_text : null,
    claims: normalizedClaims,
  };
}

/**
 * Uruchamia zadania równolegle z zachowaniem kolejności wyników i limitu współbieżności.
 */
async function mapWithConcurrency(items, concurrency, workerFn) {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await workerFn(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/**
 * Główna funkcja Modelu 3.
 *
 * Przykładowe użycie:
 *   const claims = await model2(inputText);
 *   const evidence = await model3(claims);
 *
 * @param {{ original_text?: string, claims: Array<object> }} model2Output
 * @param {object} [options]
 * @returns {Promise<object>} Zwalidowany pakiet dowodowy JSON
 */
async function model3(model2Output, options = {}) {
  const startedAt = Date.now();
  const normalizedInput = normalizeModel2Input(model2Output);
  const config = getConfig(options.config || options);

  // 1. Wczytanie i walidacja katalogu zaufanych źródeł (wyłącznie z dostarczonego JSON)
  const sourceRegistry =
    options.sourceRegistry ||
    createSourceRegistry({
      registryPath: options.registryPath || config.sourceRegistryPath,
      sourceMapPath: options.sourceMapPath !== undefined ? options.sourceMapPath : config.sourceMapPath,
      catalogData: options.catalogData,
      sourceMapData: options.sourceMapData,
    });

  // 2. Bezpieczny klient HTTP i wyszukiwanie ograniczone do zatwierdzonych hostów
  const sourceFetcher =
    options.sourceFetcher ||
    createSourceFetcher(sourceRegistry, config, {
      fetchImpl: options.fetchImpl,
      dnsLookupImpl: options.dnsLookupImpl,
    });

  const searchProvider =
    options.searchProvider !== undefined
      ? options.searchProvider
      : createSearchProvider(sourceRegistry, sourceFetcher, {
          externalSearchImpl: options.externalSearchImpl,
        });

  const globalErrors = [];
  const securityFlags = [];
  const allSourcesChecked = new Set();
  const allSourcesUnavailable = new Set();

  // 3. Równoległe przetwarzanie twierdzeń z limitem współbieżności
  const perClaimOutcomes = await mapWithConcurrency(
    normalizedInput.claims,
    config.maxConcurrency,
    async (claim) => {
      try {
        return await collectEvidenceForClaim(claim, normalizedInput.claims, {
          sourceRegistry,
          sourceFetcher,
          searchProvider,
          config,
          nowMs: options.nowMs,
        });
      } catch (err) {
        globalErrors.push({
          claim_id: claim.id,
          code: err.code || 'CLAIM_PROCESSING_ERROR',
          message: err.message,
        });
        return {
          claimResult: {
            claim_id: claim.id,
            claim: claim.claim,
            claim_type: claim.type || null,
            related_to: claim.related_to,
            search_status: 'sources_unavailable',
            selected_sources: [],
            queries: [],
            evidence: [],
            coverage: { supporting: 0, contradicting: 0, contextual: 0 },
            warnings: ['Wystąpił błąd techniczny podczas zbierania dowodów dla tego twierdzenia.'],
            errors: [{ source_id: null, url: null, status: 'internal_error', message: err.message }],
          },
          sourcesChecked: [],
          sourcesUnavailable: [],
          securityFlags: [],
        };
      }
    }
  );

  const claimResults = [];
  let totalQueries = 0;
  const uniqueSourcesWithEvidence = new Set();

  for (const outcome of perClaimOutcomes) {
    claimResults.push(outcome.claimResult);
    totalQueries += outcome.claimResult.queries.length;
    for (const sId of outcome.sourcesChecked) allSourcesChecked.add(sId);
    for (const sId of outcome.sourcesUnavailable) allSourcesUnavailable.add(sId);
    for (const flag of outcome.securityFlags) securityFlags.push(flag);
    for (const ev of outcome.claimResult.evidence) uniqueSourcesWithEvidence.add(ev.source_id);
  }

  // Jeśli źródło zadziałało choć dla jednego twierdzenia, usuwamy je z globalnej listy niedostępnych
  const strictlyUnavailable = [...allSourcesUnavailable].filter(
    (sId) => !uniqueSourcesWithEvidence.has(sId)
  );

  // 4. Wyznaczenie globalnego statusu (rozróżnienie awarii technicznej od braku dowodów)
  let globalStatus = 'completed';
  if (claimResults.length === 0) {
    globalStatus = 'no_results';
  } else if (
    claimResults.every((c) => c.search_status === 'sources_unavailable') ||
    (globalErrors.length > 0 && uniqueSourcesWithEvidence.size === 0)
  ) {
    globalStatus = 'technical_error';
  } else if (claimResults.every((c) => c.search_status === 'no_results' || c.search_status === 'no_suitable_source')) {
    globalStatus = 'no_results';
  } else if (
    claimResults.some((c) => c.search_status === 'partial' || c.search_status === 'sources_unavailable') ||
    globalErrors.length > 0
  ) {
    globalStatus = 'partial';
  }

  const output = {
    status: globalStatus,
    original_text: normalizedInput.original_text,
    claims: claimResults,
    metadata: {
      search_duration_ms: Date.now() - startedAt,
      queries_count: totalQueries,
      sources_checked: [...allSourcesChecked].sort(),
      sources_unavailable: strictlyUnavailable.sort(),
      sources_found: uniqueSourcesWithEvidence.size,
    },
    security_flags: securityFlags,
    global_errors: globalErrors,
  };

  // 5. Końcowa, bezwzględna walidacja kontraktu i zatwierdzonych hostów
  return validateModel3Output(
    output,
    sourceRegistry,
    normalizedInput.claims.map((c) => c.id)
  );
}

model3.model3 = model3;
model3.Model3Error = Model3Error;
model3.SourceRegistryError = SourceRegistryError;
model3.EvidenceValidationError = EvidenceValidationError;
model3.createSourceRegistry = createSourceRegistry;

module.exports = model3;
