const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../config');
const {
  zbierzOcenyFactCheckerow,
  relacjaZOceny,
  podobienstwo,
  charakterystyczneSlowa,
} = require('../providers/factCheckProvider');

function odpowiedzApi(claims) {
  return new Response(JSON.stringify({ claims }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function zPodstawionymFetch(odpowiedz, fn) {
  const prawdziwy = global.fetch;
  const zapytania = [];
  global.fetch = async (url) => {
    zapytania.push(String(url));
    return odpowiedz(String(url));
  };
  try {
    return { wynik: await fn(), zapytania };
  } finally {
    global.fetch = prawdziwy;
  }
}

const PPK = {
  text: 'Rząd planuje wykorzystać pieniądze zgromadzone w PPK do finansowania inwestycji publicznych.',
  claimReview: [{
    publisher: { name: 'Demagog', site: 'demagog.org.pl' },
    url: 'https://demagog.org.pl/fake_news/pieniadze-z-ppk/',
    title: 'Pieniądze z PPK na państwowe projekty? Szef PFR dementuje',
    textualRating: 'Brakujący kontekst',
  }],
};

test('Fact-check: bez klucza API nie wysyła żadnych zapytań', async () => {
  const claim = { id: 'c1', claim: PPK.text, type: 'fact' };
  const { wynik, zapytania } = await zPodstawionymFetch(() => odpowiedzApi([PPK]), () =>
    zbierzOcenyFactCheckerow(claim, [claim], getConfig({ factCheckApiKey: null }), Date.now())
  );
  assert.equal(zapytania.length, 0);
  assert.deepEqual(wynik.evidence, []);
});

test('Fact-check: ocena "Brakujący kontekst" od Demagoga daje dowód przeciw z rozbieżnością', async () => {
  const claim = { id: 'c1', claim: 'Rząd planuje wykorzystać pieniądze z PPK do finansowania inwestycji publicznych.', type: 'fact' };
  const { wynik, zapytania } = await zPodstawionymFetch(() => odpowiedzApi([PPK]), () =>
    zbierzOcenyFactCheckerow(claim, [claim], getConfig({ factCheckApiKey: 'test' }), Date.now())
  );
  assert.equal(zapytania.length, 1);
  assert.ok(zapytania[0].includes('languageCode=pl'));
  assert.equal(wynik.evidence.length, 1);
  assert.equal(wynik.evidence[0].source_id, 'FACTCHECK');
  assert.equal(wynik.evidence[0].relation_to_claim, 'contradicting');
  assert.equal(wynik.evidence[0].discrepancies.length, 1);
});

test('Fact-check: odrzuca niezaufanych wydawców i oceny innych twierdzeń', async () => {
  const claim = { id: 'c1', claim: 'Karol Nawrocki jest prezydentem Polski.', type: 'fact' };
  const { wynik } = await zPodstawionymFetch(
    () =>
      odpowiedzApi([
        {
          text: 'Karol Nawrocki na forum publicznym miał powiedzieć do prezydenta Francji: Polska nie potrzebuje nauczycieli.',
          claimReview: [{ publisher: { site: 'demagog.org.pl' }, url: 'https://demagog.org.pl/a/', textualRating: 'Fałsz' }],
        },
        {
          text: 'Karol Nawrocki jest prezydentem Polski.',
          claimReview: [{ publisher: { site: 'podejrzany.example' }, url: 'https://podejrzany.example/a', textualRating: 'Prawda' }],
        },
      ]),
    () => zbierzOcenyFactCheckerow(claim, [claim], getConfig({ factCheckApiKey: 'test' }), Date.now())
  );
  assert.deepEqual(wynik.evidence, []);
});

test('Fact-check: błąd API daje ostrzeżenie zamiast przerywać sprawdzanie', async () => {
  const claim = { id: 'c1', claim: 'ABW zatrzymało szpiegów.', type: 'fact' };
  const { wynik } = await zPodstawionymFetch(() => new Response('{}', { status: 403 }), () =>
    zbierzOcenyFactCheckerow(claim, [claim], getConfig({ factCheckApiKey: 'test' }), Date.now())
  );
  assert.deepEqual(wynik.evidence, []);
  assert.equal(wynik.warnings.length, 1);
});

test('Fact-check: mapowanie ocen, słowa kluczowe i podobieństwo', () => {
  assert.equal(relacjaZOceny('Fałsz').relacja, 'contradicting');
  assert.equal(relacjaZOceny('Manipulacja').rozbieznosc, true);
  assert.equal(relacjaZOceny('Prawda').relacja, 'supporting');
  assert.equal(relacjaZOceny('Nieweryfikowalne').relacja, 'contextual');
  assert.equal(charakterystyczneSlowa('ABW zatrzymało szpiegów działających na rzecz Ukrainy')[0], 'ABW');
  assert.ok(podobienstwo('ABW zatrzymała ukraińskich szpiegów', 'ABW zatrzymało szpiegów działających na rzecz ukraińskich sił specjalnych.') >= 0.6);
  assert.ok(podobienstwo('Karol Nawrocki jest prezydentem Polski', 'Podczas orędzia Karol Nawrocki potwierdził, że Polska jest przygotowywana do wojny z Rosją.') < 0.6);
});
