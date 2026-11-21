const test = require('node:test');
const assert = require('node:assert/strict');
const { uruchomPipeline, PipelineError } = require('./pipeline');
const { normalizujUrlGenerate } = require('./filtr_tekstu/filtr_tekstu');
const { Model2Error } = require('./rozpoznawacz_kontekstów/model2');
const { BladWalidacji } = require('./dodatki/zabezpieczenia');

function makeMockResponse({ status = 200, headers = {}, body = '' }) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headerMap.get(String(k).toLowerCase()) || null },
    text: async () => body,
  };
}

test('normalizujUrlGenerate zapewnia spójność OLLAMA_URL między Modelem 1, 2 i 3', () => {
  assert.equal(
    normalizujUrlGenerate('http://100.127.211.111:11434'),
    'http://100.127.211.111:11434/api/generate'
  );
  assert.equal(
    normalizujUrlGenerate('http://100.127.211.111:11434/'),
    'http://100.127.211.111:11434/api/generate'
  );
  assert.equal(
    normalizujUrlGenerate('http://100.127.211.111:11434/api/generate'),
    'http://100.127.211.111:11434/api/generate'
  );
  assert.equal(
    normalizujUrlGenerate('http://100.127.211.111:11434/api/chat'),
    'http://100.127.211.111:11434/api/generate'
  );
});

test('uruchomPipeline spina prawdziwy Model 1 (tekst), Model 2 i prawdziwy Model 3 w jeden spójny wynik', async () => {
  const wynik = await uruchomPipeline(
    { tekst: 'CERT Polska ostrzega przed fałszywymi SMS-ami o paczce.' },
    {
      model2Impl: async (tekstPoM1) => {
        assert.match(tekstPoM1, /===== \[TEKST\] =====/);
        return {
          original_text: tekstPoM1,
          claims: [
            {
              id: 'k1',
              claim: 'CERT Polska ostrzega przed fałszywymi SMS-ami o paczce.',
              type: 'event',
              related_to: [],
              ambiguous: false,
            },
          ],
        };
      },
      model3: {
        nowMs: Date.parse('2026-11-21T15:00:00Z'),
        maxRounds: 1,
        fetchImpl: async (url) => {
          if (url === 'https://moje.cert.pl/advisories/feed/') {
            return makeMockResponse({
              headers: { 'content-type': 'application/xml' },
              body: `<?xml version="1.0"?><rss version="2.0"><channel><item>
                <title>Ostrzeżenie przed fałszywymi SMS-ami o paczce</title>
                <link>https://moje.cert.pl/komunikaty/sms-paczka</link>
                <pubDate>Sat, 21 Nov 2026 10:00:00 +0000</pubDate>
                <description>CERT Polska ostrzega przed fałszywymi SMS-ami o paczce rozsyłanymi przez oszustów.</description>
              </item></channel></rss>`,
            });
          }
          return makeMockResponse({ headers: { 'content-type': 'text/html' }, body: '<html><body>Inne informacje</body></html>' });
        },
      },
      demagog: { useLlm: false },
    }
  );

  assert.deepEqual(wynik.metadane.etapy_ukonczone, ['model1', 'model2', 'model3', 'demagog']);
  assert.equal(wynik.metadane.liczba_twierdzen, 1);
  assert.ok(wynik.metadane.liczba_dowodow >= 1);
  assert.equal(wynik.tekst, wynik.model1.tekst);
  assert.equal(wynik.model3.claims[0].claim_id, 'k1');
  assert.ok(wynik.model3.claims[0].category_labels.includes('Cyberbezpieczeństwo'));
  assert.ok(wynik.model3.claims[0].evidence.some((e) => e.source_id === 'SRC014'));
  assert.equal(wynik.demagog.twierdzenia[0].werdykt, 'Potwierdzone');
});

test('uruchomPipeline obsługuje przypadek 0 twierdzeń z Modelu 2 bez błędu', async () => {
  const wynik = await uruchomPipeline(
    { tekst: 'Cześć!' },
    {
      model2Impl: async (tekstPoM1) => ({ original_text: tekstPoM1, claims: [] }),
      model3: { maxRounds: 1, fetchImpl: async () => makeMockResponse({ body: '' }) },
    }
  );

  assert.equal(wynik.status, 'no_results');
  assert.equal(wynik.metadane.liczba_twierdzen, 0);
  assert.equal(wynik.metadane.liczba_dowodow, 0);
  assert.ok(wynik.metadane.ostrzezenia.length >= 1);
});

test('uruchomPipeline mapuje timeout Modelu 2 na PipelineError HTTP 504 z etap="model2"', async () => {
  await assert.rejects(
    () =>
      uruchomPipeline(
        { tekst: 'Testowe zdanie.' },
        {
          model2Impl: async () => {
            throw new Model2Error('Przekroczono limit czasu.', 'TIMEOUT');
          },
        }
      ),
    (err) => err instanceof PipelineError && err.status === 504 && err.etap === 'model2' && err.kod === 'TIMEOUT'
  );
});

test('uruchomPipeline odrzuca puste zapytanie (400) oraz nieobsługiwany film (501)', async () => {
  await assert.rejects(
    () => uruchomPipeline({ tekst: '   ' }),
    (err) => err instanceof BladWalidacji && err.status === 400
  );

  await assert.rejects(
    () => uruchomPipeline({ film: 'video.mp4' }),
    (err) => err instanceof BladWalidacji && err.status === 501
  );
});

test('Demagog routing dla "Karol Nawrocki jest prezydentem Polski" wybiera kategorię administracji rządowej i znajduje dowód przez /api/data/search', async () => {
  const wynik = await uruchomPipeline(
    { tekst: 'Karol Nawrocki jest prezydentem Polski.' },
    {
      model2Impl: async (t) => ({
        original_text: t,
        claims: [{ id: 'k1', claim: 'Karol Nawrocki jest prezydentem Polski.', type: 'event', related_to: [], ambiguous: false }],
      }),
      model3: {
        nowMs: Date.parse('2026-11-21T15:00:00Z'),
        maxRounds: 2,
        fetchImpl: async (url) => {
          if (url.startsWith('https://www.gov.pl/api/data/search')) {
            return makeMockResponse({
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                count: 1,
                results: [
                  {
                    title: 'Prezydent RP Karol Nawrocki na uroczystości otwarcia Via Baltica',
                    intro: 'Karol Nawrocki złożył wizytę jako Prezydent Polski.',
                    url: '/web/litwa/prezydent-rp-karol-nawrocki',
                  },
                ],
              }),
            });
          }
          if (url === 'https://www.gov.pl/web/litwa/prezydent-rp-karol-nawrocki') {
            return makeMockResponse({
              headers: { 'content-type': 'text/html' },
              body: '<html><head><meta property="article:published_time" content="2025-10-21T09:31:47Z"><title>Prezydent RP Karol Nawrocki</title></head><body><main><p>Prezydent RP Karol Nawrocki reprezentował Polskę podczas uroczystości otwarcia litewskiego odcinka Via Baltica.</p></main></body></html>',
            });
          }
          return makeMockResponse({ headers: { 'content-type': 'text/html' }, body: '<html><body><main><p>Strona główna KPRM.</p></main></body></html>' });
        },
      },
      demagog: { useLlm: false },
    }
  );

  assert.ok(wynik.model3.claims[0].category_labels.includes('Informacje administracji rządowej'));
  assert.ok(wynik.model3.claims[0].evidence.length >= 1);
  assert.equal(wynik.werdykt_ogolny, 'Potwierdzone');
  assert.equal(wynik.demagog.twierdzenia[0].werdykt, 'Potwierdzone');
});
