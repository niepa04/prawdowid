// deduplicator.js - Deduplikacja materiałów i grupowanie niezależności (independence_group)
const crypto = require('node:crypto');

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'yclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
]);

/**
 * Kanonizuje adres URL usuwając parametry śledzące, fragmenty i końcowe slashe.
 */
function canonicalizeUrl(urlString) {
  try {
    const u = new URL(urlString);
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    const kept = [];
    for (const [k, v] of u.searchParams.entries()) {
      const lower = k.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) continue;
      kept.push([k, v]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    u.search = '';
    for (const [k, v] of kept) {
      u.searchParams.append(k, v);
    }
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.href;
  } catch {
    return String(urlString || '').trim();
  }
}

function normalizeContentForHash(item) {
  const combined = [item.title || '', ...(item.relevant_excerpts || [])].join(' ');
  return combined
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentHash(normalizedText) {
  return crypto.createHash('sha256').update(normalizedText).digest('hex');
}

function tokenSet(normalizedText) {
  return new Set(normalizedText.split(/\s+/).filter((w) => w.length >= 3));
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function metadataRichnessScore(item) {
  let score = 0;
  if (item.title) score += 2;
  if (item.published_at) score += 3;
  if (item.updated_at) score += 1;
  if (item.observed_at) score += 2;
  score += (item.relevant_excerpts || []).length;
  return score;
}

/**
 * Usuwa duplikaty URL/treści i przypisuje grupy niezależności (independence_group).
 * @param {Array<object>} evidenceList
 * @returns {{ evidence: Array<object>, duplicatesRemoved: number }}
 */
function deduplicateEvidence(evidenceList) {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    return { evidence: [], duplicatesRemoved: 0 };
  }

  const byCanonicalUrl = new Map();
  let duplicatesRemoved = 0;

  // 1. Deduplikacja po kanonicznym URL (w tym URL różniących się parametrami śledzącymi)
  for (const item of evidenceList) {
    const canonUrl = canonicalizeUrl(item.url);
    const key = `${canonUrl}|${item.title || ''}`;
    const existing = byCanonicalUrl.get(key);

    if (!existing) {
      byCanonicalUrl.set(key, { ...item, _canonUrl: canonUrl });
    } else {
      duplicatesRemoved++;
      if (metadataRichnessScore(item) > metadataRichnessScore(existing)) {
        byCanonicalUrl.set(key, { ...item, _canonUrl: canonUrl });
      }
    }
  }

  // 2. Deduplikacja dokładnych kopii treści z tego samego source_id
  const afterUrlDedup = [...byCanonicalUrl.values()];
  const uniqueItems = [];
  const seenSourceHash = new Set();

  for (const item of afterUrlDedup) {
    const norm = normalizeContentForHash(item);
    const hash = contentHash(norm);
    const sourceHashKey = `${item.source_id}|${hash}`;
    if (norm.length >= 20 && seenSourceHash.has(sourceHashKey)) {
      duplicatesRemoved++;
      continue;
    }
    seenSourceHash.add(sourceHashKey);
    uniqueItems.push({
      ...item,
      _normContent: norm,
      _hash: hash,
      _tokens: tokenSet(norm),
    });
  }

  // 3. Grupowanie niezależności (independence_group) dla powielonych komunikatów z różnych źródeł
  const groups = []; // { id: 'g1', hashes: Set, tokensList: Array<Set>, members: Array }

  for (const item of uniqueItems) {
    if (item._tokens.size < 4) {
      item.independence_group = 'unknown';
      continue;
    }

    let matchedGroup = null;
    for (const group of groups) {
      if (group.hashes.has(item._hash)) {
        matchedGroup = group;
        break;
      }
      const isNearDuplicate = group.tokensList.some((tSet) => jaccardSimilarity(item._tokens, tSet) >= 0.65);
      if (isNearDuplicate) {
        matchedGroup = group;
        break;
      }
    }

    if (matchedGroup) {
      item.independence_group = matchedGroup.id;
      matchedGroup.hashes.add(item._hash);
      matchedGroup.tokensList.push(item._tokens);
      matchedGroup.members.push(item);

      const note = `Materiał powiela treść z grupy niezależności ${matchedGroup.id} – nie należy liczyć go jako niezależnego potwierdzenia.`;
      if (!item.limitations.includes(note)) {
        item.limitations = [...item.limitations, note];
      }
    } else {
      const groupId = `g${groups.length + 1}`;
      item.independence_group = groupId;
      groups.push({
        id: groupId,
        hashes: new Set([item._hash]),
        tokensList: [item._tokens],
        members: [item],
      });
    }
  }

  // Oczyszczenie pól wewnętrznych
  const cleaned = uniqueItems.map((item) => {
    const copy = { ...item };
    delete copy._canonUrl;
    delete copy._normContent;
    delete copy._hash;
    delete copy._tokens;
    delete copy._matchScore;
    delete copy._isStale;
    return copy;
  });

  return {
    evidence: cleaned,
    duplicatesRemoved,
  };
}

module.exports = {
  canonicalizeUrl,
  jaccardSimilarity,
  deduplicateEvidence,
};
