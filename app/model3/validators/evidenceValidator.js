// evidenceValidator.js - Ścisła walidacja pakietu dowodowego zwracanego przez Model 3

const ALLOWED_GLOBAL_STATUSES = Object.freeze([
  'completed',
  'partial',
  'no_results',
  'technical_error',
]);

const ALLOWED_CLAIM_STATUSES = Object.freeze([
  'completed',
  'partial',
  'no_results',
  'no_suitable_source',
  'sources_unavailable',
]);

const ALLOWED_RELATIONS = Object.freeze(['supporting', 'contradicting', 'contextual']);
const ALLOWED_RELEVANCE = Object.freeze(['direct', 'partial', 'contextual']);
const FORBIDDEN_VERDICT_KEYS = Object.freeze(['verdict', 'is_true', 'truth_value', 'fact_check_result', 'werdykt']);

class EvidenceValidationError extends Error {
  constructor(message, code = 'EVIDENCE_VALIDATION_ERROR') {
    super(message);
    this.name = 'EvidenceValidationError';
    this.code = code;
  }
}

/**
 * Waliduje pakiet wynikowy Modelu 3 przeciwko kontraktowi JSON i rejestrowi zaufanych źródeł.
 */
function validateModel3Output(output, sourceRegistry, expectedClaimIds = null) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new EvidenceValidationError('Wynik Modelu 3 musi być obiektem JSON.', 'INVALID_ROOT');
  }

  for (const key of FORBIDDEN_VERDICT_KEYS) {
    if (key in output) {
      throw new EvidenceValidationError(
        `Wynik Modelu 3 nie może zawierać pola werdyktu "${key}".`,
        'FORBIDDEN_VERDICT_FIELD'
      );
    }
  }

  if (!ALLOWED_GLOBAL_STATUSES.includes(output.status)) {
    throw new EvidenceValidationError(
      `Nieprawidłowy globalny status Modelu 3: "${String(output.status)}".`,
      'INVALID_STATUS'
    );
  }

  if (!Array.isArray(output.claims)) {
    throw new EvidenceValidationError('Pole "claims" musi być tablicą.', 'INVALID_CLAIMS');
  }

  const seenClaimIds = new Set();

  for (let i = 0; i < output.claims.length; i++) {
    const c = output.claims[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new EvidenceValidationError(`Element claims[${i}] musi być obiektem.`, 'INVALID_CLAIM');
    }

    for (const key of FORBIDDEN_VERDICT_KEYS) {
      if (key in c) {
        throw new EvidenceValidationError(
          `Twierdzenie "${c.claim_id}" nie może zawierać pola werdyktu "${key}".`,
          'FORBIDDEN_VERDICT_FIELD'
        );
      }
    }

    if (typeof c.claim_id !== 'string' || c.claim_id.trim().length === 0) {
      throw new EvidenceValidationError(`Element claims[${i}] musi mieć poprawne pole "claim_id".`, 'INVALID_CLAIM_ID');
    }
    if (seenClaimIds.has(c.claim_id)) {
      throw new EvidenceValidationError(`Zduplikowane claim_id: "${c.claim_id}".`, 'DUPLICATE_CLAIM_ID');
    }
    seenClaimIds.add(c.claim_id);

    if (typeof c.claim !== 'string' || c.claim.trim().length === 0) {
      throw new EvidenceValidationError(`Twierdzenie "${c.claim_id}" musi mieć niepuste pole "claim".`, 'INVALID_CLAIM_TEXT');
    }

    if (!ALLOWED_CLAIM_STATUSES.includes(c.search_status)) {
      throw new EvidenceValidationError(
        `Nieprawidłowy search_status "${String(c.search_status)}" dla "${c.claim_id}".`,
        'INVALID_CLAIM_STATUS'
      );
    }

    if (!Array.isArray(c.selected_sources) || !Array.isArray(c.queries) || !Array.isArray(c.evidence)) {
      throw new EvidenceValidationError(
        `Twierdzenie "${c.claim_id}" musi mieć tablice selected_sources, queries i evidence.`,
        'INVALID_CLAIM_ARRAYS'
      );
    }

    if (!Array.isArray(c.warnings) || !Array.isArray(c.errors)) {
      throw new EvidenceValidationError(
        `Twierdzenie "${c.claim_id}" musi mieć tablice warnings i errors.`,
        'INVALID_CLAIM_ARRAYS'
      );
    }

    let sup = 0;
    let con = 0;
    let ctx = 0;

    for (let j = 0; j < c.evidence.length; j++) {
      const ev = c.evidence[j];
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" musi być obiektem.`,
          'INVALID_EVIDENCE_ITEM'
        );
      }

      if (typeof ev.source_id !== 'string' || ev.source_id.trim().length === 0) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" nie ma pola "source_id".`,
          'INVALID_EVIDENCE_SOURCE_ID'
        );
      }

      if (typeof ev.url !== 'string' || ev.url.trim().length === 0) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" nie ma pola "url".`,
          'INVALID_EVIDENCE_URL'
        );
      }

      // Twarda zapora końcowa: ŻADEN dowód spoza zatwierdzonych hostów nie może znaleźć się w pakiecie!
      if (sourceRegistry) {
        const urlCheck = sourceRegistry.validateUrl(ev.url);
        if (!urlCheck.allowed) {
          throw new EvidenceValidationError(
            `Dowód [${j}] dla "${c.claim_id}" zawiera niedozwolony adres URL (${ev.url}): ${urlCheck.reason}`,
            'UNTRUSTED_EVIDENCE_URL'
          );
        }
      }

      if (!ALLOWED_RELATIONS.includes(ev.relation_to_claim)) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" ma nieprawidłowe relation_to_claim: "${String(ev.relation_to_claim)}".`,
          'INVALID_EVIDENCE_RELATION'
        );
      }

      if (!ALLOWED_RELEVANCE.includes(ev.relevance)) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" ma nieprawidłowe relevance: "${String(ev.relevance)}".`,
          'INVALID_EVIDENCE_RELEVANCE'
        );
      }

      if (typeof ev.retrieved_at !== 'string' || Number.isNaN(Date.parse(ev.retrieved_at))) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" musi mieć poprawne pole "retrieved_at".`,
          'INVALID_RETRIEVED_AT'
        );
      }

      if (!Array.isArray(ev.relevant_excerpts) || ev.relevant_excerpts.some((ex) => typeof ex !== 'string' || ex.trim().length === 0)) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" musi mieć tablicę niepustych cytatów "relevant_excerpts".`,
          'INVALID_EXCERPTS'
        );
      }

      if (typeof ev.independence_group !== 'string' || ev.independence_group.trim().length === 0) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" musi mieć pole "independence_group".`,
          'INVALID_INDEPENDENCE_GROUP'
        );
      }

      if (!Array.isArray(ev.limitations)) {
        throw new EvidenceValidationError(
          `Dowód [${j}] dla "${c.claim_id}" musi mieć tablicę "limitations".`,
          'INVALID_LIMITATIONS'
        );
      }

      if (ev.relation_to_claim === 'supporting') sup++;
      else if (ev.relation_to_claim === 'contradicting') con++;
      else if (ev.relation_to_claim === 'contextual') ctx++;
    }

    if (
      !c.coverage ||
      c.coverage.supporting !== sup ||
      c.coverage.contradicting !== con ||
      c.coverage.contextual !== ctx
    ) {
      throw new EvidenceValidationError(
        `Niespójne pole coverage dla twierdzenia "${c.claim_id}".`,
        'INCONSISTENT_COVERAGE'
      );
    }
  }

  // Weryfikacja, że nie usunięto żadnego twierdzenia otrzymanego z Modelu 2
  if (Array.isArray(expectedClaimIds)) {
    for (const expectedId of expectedClaimIds) {
      if (!seenClaimIds.has(expectedId)) {
        throw new EvidenceValidationError(
          `Brakuje twierdzenia "${expectedId}" z wejścia Modelu 2 w wyniku Modelu 3.`,
          'MISSING_CLAIM'
        );
      }
    }
  }

  if (!output.metadata || typeof output.metadata !== 'object') {
    throw new EvidenceValidationError('Brak obiektu "metadata".', 'INVALID_METADATA');
  }
  if (
    typeof output.metadata.search_duration_ms !== 'number' ||
    typeof output.metadata.queries_count !== 'number' ||
    !Array.isArray(output.metadata.sources_checked) ||
    !Array.isArray(output.metadata.sources_unavailable) ||
    typeof output.metadata.sources_found !== 'number'
  ) {
    throw new EvidenceValidationError('Niekompletny obiekt "metadata".', 'INVALID_METADATA');
  }

  if (!Array.isArray(output.security_flags) || !Array.isArray(output.global_errors)) {
    throw new EvidenceValidationError('Pola "security_flags" i "global_errors" muszą być tablicami.', 'INVALID_ROOT_ARRAYS');
  }

  return output;
}

module.exports = {
  ALLOWED_GLOBAL_STATUSES,
  ALLOWED_CLAIM_STATUSES,
  ALLOWED_RELATIONS,
  ALLOWED_RELEVANCE,
  EvidenceValidationError,
  validateModel3Output,
};
