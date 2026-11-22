const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');

const createMessengerRouter = require('./messengerRoutes');
const { extractMessagingEvents, formatKomaResultForMessenger } = require('./messengerService');
const { handleIncomingEvent } = require('./messageHandler');
const { sendTextMessage, MessengerApiError, splitMessageForMessenger } = require('./messengerApi');

function signPayload(rawBody, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function withTestServer(deps, fn) {
  const app = express();
  app.use(createMessengerRouter(deps));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('1. Poprawna weryfikacja GET /webhook zwraca 200 i hub.challenge', async () => {
  process.env.VERIFY_TOKEN = 'TEST_VERIFY_TOKEN';
  await withTestServer({}, async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=TEST_VERIFY_TOKEN&hub.challenge=123456789`
    );
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '123456789');
  });
});

test('2. Niepoprawny Verify Token w GET /webhook zwraca 403', async () => {
  process.env.VERIFY_TOKEN = 'TEST_VERIFY_TOKEN';
  await withTestServer({}, async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=123456789`
    );
    assert.equal(res.status, 403);
  });
});

test('3. Brak parametrów weryfikacji w GET /webhook zwraca 400', async () => {
  process.env.VERIFY_TOKEN = 'TEST_VERIFY_TOKEN';
  await withTestServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/webhook?hub.mode=subscribe`);
    assert.equal(res.status, 400);
  });
});

test('4. Poprawny podpis X-Hub-Signature-256 w POST /webhook zwraca 200', async () => {
  process.env.META_APP_SECRET = 'test_app_secret_123';
  const payload = JSON.stringify({ object: 'page', entry: [{ messaging: [] }] });
  const sig = signPayload(payload, process.env.META_APP_SECRET);

  await withTestServer({ eventHandler: async () => {} }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sig,
      },
      body: payload,
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'EVENT_RECEIVED');
  });
});

test('5. Niepoprawny podpis X-Hub-Signature-256 w POST /webhook zwraca 403', async () => {
  process.env.META_APP_SECRET = 'test_app_secret_123';
  const payload = JSON.stringify({ object: 'page', entry: [] });

  await withTestServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64),
      },
      body: payload,
    });
    assert.equal(res.status, 403);
  });
});

test('6. Odbieranie wiadomości tekstowej: natychmiastowe potwierdzenie, typing_on i wynik KOMA', async () => {
  const sent = [];
  const actions = [];
  const fakePipeline = async (input) => {
    assert.equal(input.tekst, 'Sprawdź ten fakt');
    return {
      werdykt_ogolny: 'Potwierdzone',
      demagog: {
        werdykt_ogolny: 'Potwierdzone',
        kategoria_glowna: 'Administracja',
        glowna_odpowiedz: 'Potwierdzone w komunikacie.',
        glowne_zrodla: [{ title: 'GOV.PL', url: 'https://www.gov.pl' }],
        twierdzenia: [
          {
            claim: 'Sprawdź ten fakt',
            werdykt: 'Potwierdzone',
            sila_dowodow: 'wysoka',
            uzasadnienie: 'Potwierdzone w komunikacie.',
          },
        ],
      },
      metadane: { czas_calkowity_ms: 12300 },
    };
  };

  await handleIncomingEvent(
    { psid: '999888777', text: 'Sprawdź ten fakt', attachments: [] },
    {
      pipelineFn: fakePipeline,
      sendFn: async (psid, text) => sent.push({ psid, text }),
      actionFn: async (psid, action) => actions.push({ psid, action }),
      typingIntervalMs: 0,
      logger: { log: () => {}, error: () => {} },
    }
  );

  assert.ok(actions.some((a) => a.action === 'mark_seen'));
  assert.ok(actions.some((a) => a.action === 'typing_on'));
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /Mamy Twoją wiadomość/);
  assert.match(sent[1].text, /PRAWDA \(Potwierdzone\)/);
  assert.match(sent[1].text, /https:\/\/www\.gov\.pl/);
  // Upewnij się, że uzasadnienie nie powtarza się dwukrotnie
  assert.equal(sent[1].text.split('Potwierdzone w komunikacie.').length - 1, 1);
});

test('7. Ignorowanie wiadomości wysłanych przez samą stronę (is_echo i PAGE_ID)', () => {
  const events = extractMessagingEvents(
    {
      object: 'page',
      entry: [
        {
          messaging: [
            { sender: { id: 'PAGE_123' }, message: { text: 'Moja odpowiedź' } },
            { sender: { id: 'USER_456' }, message: { is_echo: true, text: 'Echo' } },
            { sender: { id: 'USER_789' }, message: { text: 'Wiadomość użytkownika' } },
          ],
        },
      ],
    },
    'PAGE_123'
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].psid, 'USER_789');
  assert.equal(events[0].text, 'Wiadomość użytkownika');
});

test('8. Obsługa wiadomości ze zdjęciem (natychmiastowe potwierdzenie i przekazanie do KOMA)', async () => {
  const events = extractMessagingEvents({
    object: 'page',
    entry: [
      {
        messaging: [
          {
            sender: { id: 'USER_111' },
            message: {
              attachments: [{ type: 'image', payload: { url: 'https://example.com/img.png' } }],
            },
          },
        ],
      },
    ],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].attachments.length, 1);
  assert.equal(events[0].attachments[0].type, 'image');

  const sent = [];
  await handleIncomingEvent(events[0], {
    downloadImageFn: async () => 'data:image/png;base64,AAAA',
    pipelineFn: async (payload) => {
      assert.deepEqual(payload.zdjecia, ['data:image/png;base64,AAAA']);
      return {
        werdykt_ogolny: 'Fałszywe',
        demagog: {
          werdykt_ogolny: 'Fałszywe',
          glowna_odpowiedz: 'Zrzut ekranu został zmanipulowany.',
          twierdzenia: [{ werdykt: 'Fałszywe', uzasadnienie: 'Zrzut ekranu został zmanipulowany.' }],
        },
      };
    },
    sendFn: async (psid, text) => sent.push({ psid, text }),
    actionFn: async () => {},
    typingIntervalMs: 0,
    logger: { log: () => {}, error: () => {} },
  });
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /screena/);
  assert.match(sent[1].text, /FAKE \(Fałszywe\)/);
});

test('9. Obsługa niepoprawnego payloadu POST /webhook zwraca 400', async () => {
  process.env.META_APP_SECRET = 'test_app_secret_123';
  const payload = JSON.stringify({ object: 'unknown', invalid: true });
  const sig = signPayload(payload, process.env.META_APP_SECRET);

  await withTestServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sig,
      },
      body: payload,
    });
    assert.equal(res.status, 400);
  });
});

test('10. Obsługa błędów Meta API (rate limit 429) i dzielenie długich wiadomości', async () => {
  const chunks = splitMessageForMessenger('A'.repeat(4500), 2000);
  assert.equal(chunks.length, 3);

  await assert.rejects(
    () =>
      sendTextMessage('12345', 'Test', {
        pageAccessToken: 'fake_token',
        fetchImpl: async () => ({
          ok: false,
          status: 429,
          json: async () => ({ error: { message: 'Rate limit exceeded', code: 4 } }),
        }),
      }),
    (err) => err instanceof MessengerApiError && err.isRateLimit === true && err.status === 429
  );
});

test('11. Szybka odpowiedź na przywitanie bez uruchamiania pipeline KOMA', async () => {
  const sent = [];
  let pipelineCalled = false;

  await handleIncomingEvent(
    { psid: 'USER_HELLO', text: 'hej!', attachments: [] },
    {
      pipelineFn: async () => {
        pipelineCalled = true;
        return {};
      },
      sendFn: async (psid, text) => sent.push({ psid, text }),
      actionFn: async () => {},
      typingIntervalMs: 0,
      logger: { log: () => {}, error: () => {} },
    }
  );

  assert.equal(pipelineCalled, false);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /detektor fake newsów/);
});

test('12. Formatowanie wielu twierdzeń bez powtarzania uzasadnień i bez surowych linków markdown', () => {
  const formatted = formatKomaResultForMessenger({
    werdykt_ogolny: 'Wprowadzające w błąd',
    demagog: {
      werdykt_ogolny: 'Wprowadzające w błąd',
      kategoria_glowna: 'Transport',
      glowna_odpowiedz: '[Potwierdzone] Pierwsze. [Fałszywe] Drugie.',
      glowne_zrodla: [{ title: 'GDDKiA', publisher: 'GOV', url: 'https://www.gov.pl/gddkia' }],
      twierdzenia: [
        { claim: 'Twierdzenie 1', werdykt: 'Potwierdzone', uzasadnienie: 'Pierwsze uzasadnienie.' },
        { claim: 'Twierdzenie 2', werdykt: 'Fałszywe', uzasadnienie: 'Drugie uzasadnienie.' },
      ],
    },
  });

  assert.equal(formatted.split('Pierwsze uzasadnienie.').length - 1, 1);
  assert.equal(formatted.split('Drugie uzasadnienie.').length - 1, 1);
  assert.doesNotMatch(formatted, /\[GDDKiA\]\(/);
});

test('13. GET /privacy zwraca HTTP 200 oraz poprawny HTML polityki prywatności', async () => {
  const app = require('./index');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/privacy`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /Polityka Prywatności – KOMA \(PRAWDOWID\)/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
