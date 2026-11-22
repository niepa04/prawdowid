const test = require('node:test');
const assert = require('node:assert/strict');
const { linkiZgloszenia, zaufaneLinki, kluczUrl } = require('./zaufaneDomeny');
const { uruchomPipeline } = require('../pipeline');
const { zbierzResearch } = require('../research/researchGatherer');

test('Zaufane domeny: rozpoznaje źródła urzędowe i fact-checkerów, pomija inne strony', () => {
  const linki = linkiZgloszenia({
    tekst: 'Zobacz https://www.gov.pl/web/premier/komunikat-1, oraz https://wyborcza.pl/7,75398/x.html.',
    linki: ['https://demagog.org.pl/wypowiedzi/abc/'],
  });
  assert.equal(linki.length, 3);
  const zaufane = zaufaneLinki(linki);
  assert.deepEqual(zaufane.map((z) => z.host), ['demagog.org.pl', 'gov.pl']);
  assert.equal(zaufane.find((z) => z.host === 'gov.pl').nazwa, 'Kancelaria Prezesa Rady Ministrów (KPRM)');
  assert.equal(zaufane.find((z) => z.host === 'demagog.org.pl').rodzaj, 'fact-checker');
});

test('Zaufane domeny: klucz adresu ignoruje www, końcowy ukośnik, parametry i kotwicę', () => {
  assert.equal(kluczUrl('https://www.gov.pl/web/premier/a/?x=1#y'), kluczUrl('http://gov.pl/web/premier/a'));
});

test('Pipeline: link z zaufanej domeny -> komunikat, a strona z linku trafia na listę wykluczeń researchu', async () => {
  let dodatkowe = null;
  const wynik = await uruchomPipeline(
    { tekst: 'https://www.gov.pl/web/premier/komunikat-1' },
    {
      model1Impl: async () => '===== [LINKI] =====\nPremier ogłosił nowy program.',
      researchImpl: async (t, d) => {
        dodatkowe = d;
        return { plan: {}, materialy: [], notatka: {}, ostrzezenia: [], status: 'completed' };
      },
      weryfikatorImpl: async () => ({ werdykt_ogolny: 'Brak wystarczających dowodów', twierdzenia: [] }),
    }
  );
  assert.deepEqual(dodatkowe.wykluczUrl, ['https://www.gov.pl/web/premier/komunikat-1']);
  assert.ok(wynik.zrodlo_zgloszenia);
  assert.match(wynik.zrodlo_zgloszenia.komunikat, /zweryfikowanego źródła: Kancelaria Prezesa Rady Ministrów/);
  assert.match(wynik.zrodlo_zgloszenia.komunikat, /na innych stronach/);
});

test('Pipeline: link spoza zaufanych domen -> brak komunikatu o zaufanym źródle', async () => {
  const wynik = await uruchomPipeline(
    { tekst: 'https://wyborcza.pl/7,75398/x.html' },
    {
      model1Impl: async () => '===== [LINKI] =====\nArtykuł.',
      researchImpl: async () => ({ plan: {}, materialy: [], notatka: {}, ostrzezenia: [], status: 'completed' }),
      weryfikatorImpl: async () => ({ werdykt_ogolny: 'Brak wystarczających dowodów', twierdzenia: [] }),
    }
  );
  assert.equal(wynik.zrodlo_zgloszenia, null);
});

test('Research Gatherer: strona z linku użytkownika nie trafia do materiałów, inne strony tak', async () => {
  const dowod = (url, tytul) => ({ url, title: tytul, publisher: 'gov.pl', source_id: 'SRC040', source_type: 'official', relevance: 'direct', relevant_excerpts: ['fragment'] });
  const wynik = await zbierzResearch('===== [LINKI] =====\nPremier ogłosił nowy program.', {
    wykluczUrl: ['https://www.gov.pl/web/premier/komunikat-1'],
    fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ temat: 't', pytania_badawcze: [{ pytanie: 'Czy premier ogłosił program?', zapytanie: 'premier program' }], streszczenie: 's', ustalenia: [] }) } }) }),
    model3Impl: async () => ({
      status: 'completed',
      claims: [{ claim_id: 'p1', evidence: [dowod('https://www.gov.pl/web/premier/komunikat-1/', 'Ten sam komunikat'), dowod('https://www.gov.pl/web/mf/inny', 'Inne potwierdzenie')], warnings: [] }],
    }),
  });
  assert.deepEqual(wynik.materialy.map((m) => m.tytul), ['Inne potwierdzenie']);
  assert.equal(wynik.pominiete_strony_zgloszenia, 1);
});
