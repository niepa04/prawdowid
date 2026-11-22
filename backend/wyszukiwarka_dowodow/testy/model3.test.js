const test = require('node:test');
const assert = require('node:assert/strict');
const model3 = require('../wyszukiwarkaDowodow');
const { createSourceRegistry } = require('../sourceRegistry');
const { validateModel3Output, EvidenceValidationError } = require('../validators/evidenceValidator');

const NOW_MS = Date.parse('2026-11-21T14:00:00Z');

function makeMockResponse({ status = 200, headers = {}, body = '' }) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k) => headerMap.get(String(k).toLowerCase()) || null,
    },
    text: async () => body,
  };
}

test('10. Brak wyników w odpowiednich źródłach -> search_status: no_results (nie oznacza fałszu)', async () => {
  const result = await model3(
    {
      original_text: 'CERT Polska wydał komunikat o ataku na lodówki kosmiczne.',
      claims: [
        {
          id: 'k1',
          claim: 'CERT Polska wydał komunikat o ataku na lodówki kosmiczne.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      fetchImpl: async (url) => {
        if (url === 'https://moje.cert.pl/advisories/feed/') {
          return makeMockResponse({
            headers: { 'content-type': 'application/xml' },
            body: `<?xml version="1.0"?><rss version="2.0"><channel><item>
              <title>Aktualizacja zabezpieczeń routera X</title>
              <link>https://moje.cert.pl/komunikaty/router-x</link>
              <pubDate>Sat, 21 Nov 2026 08:00:00 +0000</pubDate>
              <description>Komunikat dotyczy podatności w oprogramowaniu routera X.</description>
            </item></channel></rss>`,
          });
        }
        return makeMockResponse({ headers: { 'content-type': 'text/html' }, body: '<html><body><p>Brak powiązanych komunikatów.</p></body></html>' });
      },
    }
  );

  assert.equal(result.status, 'no_results');
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].claim_id, 'k1');
  assert.equal(result.claims[0].search_status, 'no_results');
  assert.equal(result.claims[0].evidence.length, 0);
  assert.ok(result.claims[0].warnings.some((w) => /nie oznacza/i.test(w)));
});

test('11. Sprzeczne materiały -> wykrywa zarówno supporting, jak i contradicting oraz dodaje ostrzeżenie', async () => {
  const result = await model3(
    {
      original_text: 'Wprowadzono ostrzeżenie przed silnym wiatrem w województwie mazowieckim.',
      claims: [
        {
          id: 'k1',
          claim: 'Wprowadzono ostrzeżenie przed silnym wiatrem w województwie mazowieckim.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      fetchImpl: async (url) => {
        if (url.includes('/api/data/proxy/rso/komunikatyxml/wszystkie')) {
          return makeMockResponse({
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              newses: [
                {
                  id: 1,
                  title: 'Ostrzeżenie przed silnym wiatrem – Mazowieckie',
                  shortcut: 'Wprowadzono ostrzeżenie przed silnym wiatrem w województwie mazowieckim.',
                  content: 'IMGW wprowadziło ostrzeżenie I stopnia przed silnym wiatrem w województwie mazowieckim.',
                  valid_from: '2026-11-21 10:00:00',
                  valid_to: '2026-11-21 22:00:00',
                  location_name: 'mazowieckie',
                },
              ],
            }),
          });
        }
        if (url.includes('/api/data/proxy/rso/komunikatyxml/mazowieckie')) {
          return makeMockResponse({
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              newses: [
                {
                  id: 2,
                  title: 'Odwołanie ostrzeżenia przed silnym wiatrem – Mazowieckie',
                  shortcut: 'Odwołano ostrzeżenie przed silnym wiatrem w województwie mazowieckim.',
                  content: 'Służby odwołały ostrzeżenie przed silnym wiatrem w województwie mazowieckim – nie obowiązuje.',
                  valid_from: '2026-11-21 13:30:00',
                  valid_to: '2026-11-21 20:00:00',
                  location_name: 'mazowieckie',
                },
              ],
            }),
          });
        }
        return makeMockResponse({ headers: { 'content-type': 'text/html' }, body: '<html><body>Brak danych</body></html>' });
      },
    }
  );

  const c = result.claims[0];
  assert.ok(c.coverage.supporting >= 1, `Oczekiwano >= 1 supporting, było ${c.coverage.supporting}`);
  assert.ok(c.coverage.contradicting >= 1, `Oczekiwano >= 1 contradicting, było ${c.coverage.contradicting}`);
  assert.ok(c.warnings.some((w) => /sprzeczn/i.test(w)));
});

test('12. Nieaktualny komunikat (valid_to w przeszłości) zostaje oznaczony w limitations i nie dostaje supporting', async () => {
  const result = await model3(
    {
      original_text: 'Obowiązuje ostrzeżenie przed silnym wiatrem w mazowieckim.',
      claims: [
        {
          id: 'k1',
          claim: 'Obowiązuje ostrzeżenie przed silnym wiatrem w mazowieckim.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      fetchImpl: async (url) => {
        if (url.includes('/api/data/proxy/rso/komunikatyxml/')) {
          return makeMockResponse({
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              newses: [
                {
                  id: 10,
                  title: 'Ostrzeżenie przed silnym wiatrem w mazowieckim',
                  content: 'Obowiązuje ostrzeżenie przed silnym wiatrem w województwie mazowieckim.',
                  valid_from: '2025-01-10 08:00:00',
                  valid_to: '2025-01-10 18:00:00',
                  location_name: 'mazowieckie',
                },
              ],
            }),
          });
        }
        return makeMockResponse({ headers: { 'content-type': 'text/html' }, body: '<html><body>Inne informacje</body></html>' });
      },
    }
  );

  const c = result.claims[0];
  assert.ok(c.evidence.length >= 1);
  assert.equal(c.coverage.supporting, 0);
  assert.equal(c.evidence[0].relation_to_claim, 'contextual');
  assert.ok(c.evidence[0].limitations.some((l) => /nieaktualny|wygasł/i.test(l)));
  assert.ok(c.warnings.some((w) => /nieaktualn/i.test(w)));
});

test('14. Brak daty publikacji zapisywany jako null (nigdy nie wymyślany) z ograniczeniem w limitations', async () => {
  const htmlWithoutDate = `<!doctype html><html lang="pl"><head><title>Ostrzeżenie GIS - żywność</title></head>
    <body><main><h1>Ostrzeżenie publiczne GIS dotyczące wycofania partii żywności</h1>
    <p>Główny Inspektorat Sanitarny informuje o wycofaniu partii żywności z powodu wykrycia bakterii Salmonella.</p>
    </main></body></html>`;

  const result = await model3(
    {
      original_text: 'GIS poinformował o wycofaniu partii żywności z powodu Salmonelli.',
      claims: [
        {
          id: 'k1',
          claim: 'GIS poinformował o wycofaniu partii żywności z powodu Salmonelli.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      fetchImpl: async (url) => {
        if (url === 'https://www.gov.pl/web/gis/ostrzezenia') {
          return makeMockResponse({ headers: { 'content-type': 'text/html' }, body: htmlWithoutDate });
        }
        return makeMockResponse({ status: 404, body: 'Not found' });
      },
    }
  );

  const gisEv = result.claims[0].evidence.find((e) => e.source_id === 'SRC010');
  assert.ok(gisEv, 'Oczekiwano dowodu z SRC010 (GIS)');
  assert.equal(gisEv.published_at, null);
  assert.ok(gisEv.limitations.some((l) => /Brak.*daty publikacji/i.test(l)));
});

test('15. Nieudostępnione API / SPA bez treści (IMGW SPA + 403) jest uczciwie raportowane bez fikcyjnych danych', async () => {
  const spaShell = '<!doctype html><html data-beasties-container><head><title>METEO IMGW</title></head><body><app-root></app-root></body></html>';

  const result = await model3(
    {
      original_text: 'MSZ odradza podróże do przykładowego państwa.',
      claims: [
        {
          id: 'k1',
          claim: 'MSZ odradza podróże do przykładowego państwa.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      fetchImpl: async () => makeMockResponse({ status: 200, headers: { 'content-type': 'text/html' }, body: spaShell }),
    }
  );

  assert.equal(result.claims[0].search_status, 'sources_unavailable');
  assert.equal(result.claims[0].evidence.length, 0);
  assert.ok(result.claims[0].errors.some((e) => e.status === 'requires_js_rendering'));
});

test('16. Awaria jednej strony (np. Incapsula WAF na GDDKiA) nie przerywa zbierania dowodów z pozostałych źródeł (RSO)', async () => {
  const incapsulaHtml = '<html style="height:100%"><head><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></head><body></body></html>';

  const result = await model3(
    {
      original_text: 'Na autostradzie A1 występuje poważne utrudnienie drogowe po wypadku.',
      claims: [
        {
          id: 'k1',
          claim: 'Na autostradzie A1 występuje poważne utrudnienie drogowe po wypadku.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      fetchImpl: async (url) => {
        if (url.includes('drogi.gddkia.gov.pl')) {
          return makeMockResponse({ status: 200, headers: { 'content-type': 'text/html' }, body: incapsulaHtml });
        }
        if (url.includes('/api/data/proxy/rso/komunikatyxml/')) {
          return makeMockResponse({
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              newses: [
                {
                  id: 55,
                  title: 'Utrudnienie drogowe na autostradzie A1',
                  content: 'Na autostradzie A1 występuje poważne utrudnienie drogowe po wypadku samochodu ciężarowego.',
                  valid_from: '2026-11-21 12:00:00',
                  valid_to: '2026-11-21 18:00:00',
                  location_name: 'łódzkie',
                },
              ],
            }),
          });
        }
        return makeMockResponse({ status: 500, body: 'Server error' });
      },
    }
  );

  assert.equal(result.status, 'partial');
  assert.equal(result.claims[0].search_status, 'partial');
  assert.ok(result.claims[0].evidence.some((e) => e.source_id === 'SRC002'));
  assert.ok(result.claims[0].errors.some((e) => e.status === 'blocked_by_waf'));
  assert.ok(result.metadata.sources_unavailable.length >= 1);
});

test('17. Awaria całej kategorii źródeł zwraca status technical_error / sources_unavailable (nie werdykt)', async () => {
  const result = await model3(
    {
      original_text: 'CERT Polska ostrzega przed phishingiem.',
      claims: [
        {
          id: 'k1',
          claim: 'CERT Polska ostrzega przed phishingiem.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    }
  );

  assert.equal(result.status, 'technical_error');
  assert.equal(result.claims[0].search_status, 'sources_unavailable');
  assert.equal(result.claims[0].evidence.length, 0);
  assert.ok(result.claims[0].errors.length >= 1);
  assert.ok(result.claims[0].warnings.some((w) => /nie werdykt/i.test(w)));
});

test('20. Kilka twierdzeń przetwarzanych równolegle zachowuje kolejność, osobne dopasowanie i licznik coverage', async () => {
  const result = await model3(
    {
      original_text: 'PAA zmierzyła normalną moc dawki promieniowania w Zagórzu, a CERT Polska ostrzega przed phishingiem.',
      claims: [
        {
          id: 'k1',
          claim: 'Stacja PAA Zagórz zarejestrowała pomiar mocy dawki promieniowania gamma.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
        {
          id: 'k2',
          claim: 'CERT Polska ostrzega przed nową kampanią phishingową.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
        {
          id: 'k3',
          claim: 'To najgorsza sytuacja od lat.',
          type: 'opinion',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      maxConcurrency: 3,
      fetchImpl: async (url) => {
        if (url.includes('monitoring.paa.gov.pl/geoserver/ows')) {
          return makeMockResponse({
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {
                    stacja: 'Zagórz',
                    tip_value: '0.084 µSv/h',
                    tip_date: '2026-11-21 13:00',
                  },
                },
              ],
            }),
          });
        }
        if (url === 'https://moje.cert.pl/advisories/feed/') {
          return makeMockResponse({
            headers: { 'content-type': 'application/xml' },
            body: `<?xml version="1.0"?><rss version="2.0"><channel><item>
              <title>Ostrzeżenie przed nową kampanią phishingową</title>
              <link>https://moje.cert.pl/komunikaty/kampania-2026</link>
              <pubDate>Sat, 21 Nov 2026 11:00:00 +0000</pubDate>
              <description>CERT Polska ostrzega przed nową kampanią phishingową skierowaną do klientów banków.</description>
            </item></channel></rss>`,
          });
        }
        return makeMockResponse({ headers: { 'content-type': 'text/html' }, body: '<html><body>Inna treść</body></html>' });
      },
    }
  );

  assert.deepEqual(
    result.claims.map((c) => c.claim_id),
    ['k1', 'k2', 'k3']
  );
  // k1 dostało bieżący pomiar z PAA z jednostką i czasem pomiaru
  const paaEv = result.claims[0].evidence.find((e) => e.source_id === 'SRC012');
  assert.ok(paaEv, 'Oczekiwano pomiaru z PAA (SRC012)');
  assert.equal(paaEv.measurement_data.unit, 'µSv/h');
  assert.equal(paaEv.measurement_data.area, 'Zagórz');
  assert.ok(paaEv.observed_at);

  // k2 dostało ostrzeżenie z CERT
  assert.ok(result.claims[1].evidence.some((e) => e.source_id === 'SRC014'));

  // k3 (opinion) nie zostało usunięte z pakietu
  assert.equal(result.claims[2].search_status, 'no_suitable_source');
});

test('21. Brak fikcyjnych cytatów – każdy cytat w relevant_excerpts jest dosłownym fragmentem pobranej treści', async () => {
  const realBodyText =
    'Główny Inspektorat Sanitarny opublikował ostrzeżenie o wycofaniu partii herbaty ziołowej ze względu na przekroczenie poziomu alkaloidów.';

  const result = await model3(
    {
      original_text: 'GIS ostrzega o wycofaniu partii herbaty ziołowej.',
      claims: [
        {
          id: 'k1',
          claim: 'GIS ostrzega o wycofaniu partii herbaty ziołowej.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 1,
      fetchImpl: async (url) => {
        if (url === 'https://www.gov.pl/web/gis/ostrzezenia') {
          return makeMockResponse({
            headers: { 'content-type': 'text/html' },
            body: `<html><head><meta property="article:published_time" content="2026-11-21T09:00:00Z"></head><body><main><p>${realBodyText}</p></main></body></html>`,
          });
        }
        return makeMockResponse({ status: 404, body: '' });
      },
    }
  );

  const ev = result.claims[0].evidence.find((e) => e.source_id === 'SRC010');
  assert.ok(ev);
  assert.ok(ev.relevant_excerpts.length >= 1);
  for (const excerpt of ev.relevant_excerpts) {
    assert.ok(realBodyText.includes(excerpt), `Cytat nie występuje dosłownie w źródle: "${excerpt}"`);
  }
});

test('22. Walidacja końcowego JSON odrzuca dowód spoza dozwolonego hosta oraz pola werdyktu', () => {
  const registry = createSourceRegistry();
  const baseValid = {
    status: 'completed',
    claims: [
      {
        claim_id: 'k1',
        claim: 'Testowe twierdzenie.',
        search_status: 'completed',
        selected_sources: ['SRC014'],
        queries: ['site:moje.cert.pl Testowe'],
        evidence: [
          {
            source_id: 'SRC014',
            title: 'Tytuł',
            publisher: 'CERT Polska',
            published_at: null,
            updated_at: null,
            event_date: null,
            observed_at: null,
            retrieved_at: '2026-11-21T10:00:00Z',
            url: 'https://moje.cert.pl/komunikaty/test',
            relation_to_claim: 'supporting',
            relevance: 'direct',
            relevant_excerpts: ['Dosłowny fragment komunikatu.'],
            independence_group: 'g1',
            limitations: [],
          },
        ],
        coverage: { supporting: 1, contradicting: 0, contextual: 0 },
        warnings: [],
        errors: [],
      },
    ],
    metadata: {
      search_duration_ms: 12,
      queries_count: 1,
      sources_checked: ['SRC014'],
      sources_unavailable: [],
      sources_found: 1,
    },
    security_flags: [],
    global_errors: [],
  };

  assert.doesNotThrow(() => validateModel3Output(baseValid, registry, ['k1']));

  // Próba przemycenia domeny spoza katalogu w evidence[]
  const untrusted = structuredClone(baseValid);
  untrusted.claims[0].evidence[0].url = 'https://pl.wikipedia.org/wiki/Phishing';
  assert.throws(
    () => validateModel3Output(untrusted, registry, ['k1']),
    (err) => err instanceof EvidenceValidationError && err.code === 'UNTRUSTED_EVIDENCE_URL'
  );

  // Próba dodania pola werdyktu
  const withVerdict = structuredClone(baseValid);
  withVerdict.claims[0].verdict = 'TRUE';
  assert.throws(
    () => validateModel3Output(withVerdict, registry, ['k1']),
    (err) => err instanceof EvidenceValidationError && err.code === 'FORBIDDEN_VERDICT_FIELD'
  );
});

test('External search provider: odrzuca wyniki spoza zatwierdzonych domen przed pobraniem', async () => {
  const fetchedUrls = [];
  const result = await model3(
    {
      original_text: 'CERT Polska ostrzega przed fałszywym SMS o paczce.',
      claims: [
        {
          id: 'k1',
          claim: 'CERT Polska ostrzega przed fałszywym SMS o paczce.',
          type: 'event',
          related_to: [],
          ambiguous: false,
        },
      ],
    },
    {
      nowMs: NOW_MS,
      maxRounds: 2,
      externalSearchImpl: async () => [
        { url: 'https://losowy-portal.pl/sms-paczka', title: 'Blog' },
        { url: 'https://moje.cert.pl/komunikaty/sms-paczka', title: 'CERT komunikat' },
      ],
      fetchImpl: async (url) => {
        fetchedUrls.push(url);
        if (url === 'https://moje.cert.pl/komunikaty/sms-paczka') {
          return makeMockResponse({
            headers: { 'content-type': 'text/html' },
            body: '<html><head><meta property="article:published_time" content="2026-11-21T10:00:00Z"></head><body><main><p>CERT Polska ostrzega przed fałszywym SMS o paczce rozsyłanym przez oszustów.</p></main></body></html>',
          });
        }
        return makeMockResponse({ headers: { 'content-type': 'application/xml' }, body: '<rss><channel></channel></rss>' });
      },
    }
  );

  assert.ok(!fetchedUrls.some((u) => u.includes('losowy-portal.pl')));
  assert.ok(result.security_flags.some((f) => f.type === 'search_result_untrusted_host_rejected'));
  assert.ok(result.claims[0].evidence.some((e) => e.url === 'https://moje.cert.pl/komunikaty/sms-paczka'));
});
