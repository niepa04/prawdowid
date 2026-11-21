const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizeUrl, deduplicateEvidence } = require('../deduplicator');

test('13a. canonicalizeUrl usuwa parametry śledzące i fragmenty', () => {
  const a = canonicalizeUrl('https://www.gov.pl/web/rcb/alert?utm_source=fb&utm_medium=social&id=5#top');
  const b = canonicalizeUrl('https://www.gov.pl/web/rcb/alert/?id=5&fbclid=xyz123');
  assert.equal(a, b);
});

test('13b. deduplicateEvidence usuwa duplikaty URL oraz grupuje powielone komunikaty w jedno independence_group', () => {
  const baseItem = {
    source_id: 'SRC002',
    title: 'Ostrzeżenie przed silnym wiatrem w mazowieckim',
    publisher: 'gov.pl RSO',
    published_at: '2026-11-21T10:00:00Z',
    updated_at: null,
    event_date: null,
    observed_at: null,
    retrieved_at: '2026-11-21T11:00:00Z',
    url: 'https://www.gov.pl/web/gov/ostrzezenia?utm_source=twitter',
    relation_to_claim: 'supporting',
    relevance: 'direct',
    relevant_excerpts: ['IMGW wydało ostrzeżenie pierwszego stopnia przed silnym wiatrem w województwie mazowieckim.'],
    independence_group: 'unknown',
    limitations: [],
  };

  const urlDuplicate = {
    ...baseItem,
    url: 'https://www.gov.pl/web/gov/ostrzezenia?fbclid=999',
    published_at: null,
  };

  const crossSourceCopy = {
    ...baseItem,
    source_id: 'SRC037',
    publisher: 'RCB',
    url: 'https://www.gov.pl/web/rcb/komunikat-wiatr',
    relevant_excerpts: ['IMGW wydało ostrzeżenie pierwszego stopnia przed silnym wiatrem w województwie mazowieckim.'],
  };

  const independentSource = {
    ...baseItem,
    source_id: 'SRC006',
    publisher: 'KG PSP',
    title: 'Ponad 120 interwencji strażaków po wichurach na Mazowszu',
    url: 'https://www.gov.pl/web/kgpsp/interwencje-wichury',
    relevant_excerpts: ['Państwowa Straż Pożarna odnotowała ponad 120 interwencji przy powalonych drzewach na Mazowszu.'],
  };

  const { evidence, duplicatesRemoved } = deduplicateEvidence([
    baseItem,
    urlDuplicate,
    crossSourceCopy,
    independentSource,
  ]);

  assert.equal(duplicatesRemoved, 1);
  assert.equal(evidence.length, 3);

  const rso = evidence.find((e) => e.source_id === 'SRC002');
  const rcb = evidence.find((e) => e.source_id === 'SRC037');
  const psp = evidence.find((e) => e.source_id === 'SRC006');

  // Zachowano wersję z pełniejszymi metadanymi (published_at nie jest null)
  assert.equal(rso.published_at, '2026-11-21T10:00:00Z');
  // Powielony komunikat w RCB ma tę samą grupę niezależności co RSO
  assert.equal(rcb.independence_group, rso.independence_group);
  assert.ok(rcb.limitations.some((l) => /powiela treść/i.test(l)));
  // Niezależny raport PSP ma inną grupę niezależności
  assert.notEqual(psp.independence_group, rso.independence_group);
});
