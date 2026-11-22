const test = require('node:test');
const assert = require('node:assert/strict');
const { wykryjDaneOsobowe, sprawdzDaneOsobowe, poprawnyPesel, poprawnyDowod } = require('./daneOsobowe');
const { uruchomPipeline } = require('../pipeline');

// Poprawne (fikcyjne) numery z sumami kontrolnymi
const PESEL = '85120312343';
const DOWOD = 'ABA430000';

const typy = (t) => wykryjDaneOsobowe(t).map((z) => z.typ);

test('Dane osobowe: walidacja sum kontrolnych', () => {
  assert.equal(poprawnyPesel(PESEL), true);
  assert.equal(poprawnyPesel('85120312344'), false);
  assert.equal(poprawnyPesel('12345678901'), false);
  assert.equal(poprawnyDowod(DOWOD), true);
  assert.equal(poprawnyDowod('ABA530000'), false);
});

test('Dane osobowe: wykrywa identyfikatory, kontakty i adresy zamieszkania', () => {
  assert.deepEqual(typy(`Mój PESEL to ${PESEL}`), ['pesel']);
  assert.deepEqual(typy(`Dowód ${DOWOD}`), ['dowod']);
  assert.deepEqual(typy('Konto PL61 1090 1014 0000 0712 1981 2874'), ['konto']);
  assert.deepEqual(typy('karta 4111 1111 1111 1111'), ['karta']);
  assert.deepEqual(typy('Zadzwoń do Ani 600 123 456'), ['telefon']);
  assert.deepEqual(typy('tel. 22 694 70 00'), ['telefon']);
  assert.deepEqual(typy('Pisz na jan.kowalski@gmail.com'), ['email']);
  assert.deepEqual(typy('Kowalski mieszka przy ul. Kwiatowej 5 w Radomiu'), ['adres']);
  assert.deepEqual(typy('Jan Nowak, ul. Polna 12/4, Kraków, oszukał mnie'), ['adres']);
});

test('Dane osobowe: nie blokuje zwykłych zgłoszeń o faktach i osobach publicznych', () => {
  for (const t of [
    'Andrzej Duda urodził się 16 maja 1972 roku w Krakowie',
    'Sejm przy ul. Wiejskiej 4/6/8 przyjął ustawę',
    'Protest odbył się na ul. Marszałkowskiej 10 w Warszawie',
    'Rząd wydał 12345678901 zł na drogi?',
    'Ustawa z 2023 r. Dz.U. poz. 1234567 ma 600 artykułów',
    'Budżet to 600 123 456 zł, a PKB 3 450 123 456 zł',
    'Napisz do kancelaria@kprm.gov.pl',
  ]) {
    assert.deepEqual(typy(t), [], t);
  }
});

test('Dane osobowe: tekst użytkownika blokuje, strony z linków są tylko czyszczone', () => {
  const zTekstu = sprawdzDaneOsobowe(`===== [TEKST] =====\nCzy PESEL ${PESEL} jest ważny?`);
  assert.equal(zTekstu.zablokuj, true);
  assert.deepEqual(zTekstu.wykryte, ['numer PESEL']);
  assert.ok(!zTekstu.tekst.includes(PESEL), 'wartość nie może wrócić w odpowiedzi');

  const zLinku = sprawdzDaneOsobowe('===== [TEKST] =====\nczy to prawda?\n\n===== [LINKI] =====\nRedakcja: tel. 600 123 456. Treść artykułu.');
  assert.equal(zLinku.zablokuj, false);
  assert.equal(zLinku.wycietoZLinkow, 1);
  assert.ok(!zLinku.tekst.includes('600 123 456'));
});

test('Pipeline: dane osobowe zatrzymują zgłoszenie przed researchem', async () => {
  let research = false;
  const wynik = await uruchomPipeline(
    { tekst: `Sąsiad mieszka przy ul. Kwiatowej 5/3, jego PESEL to ${PESEL}. Czy to legalne?` },
    {
      model1Impl: async (d) => `===== [TEKST] =====\n${d.tekst}`,
      researchImpl: async () => {
        research = true;
        return {};
      },
      weryfikatorImpl: async () => ({}),
    }
  );
  assert.equal(research, false);
  assert.equal(wynik.status, 'rejected');
  assert.equal(wynik.werdykt_ogolny, 'Zablokowano: dane osobowe');
  assert.match(wynik.demagog.glowna_odpowiedz, /Nie można używać danych osobowych/);
  assert.ok(wynik.filtr_wstepny.wykryte.includes('numer PESEL'));
  assert.ok(wynik.filtr_wstepny.wykryte.includes('adres zamieszkania'));
  assert.ok(!JSON.stringify(wynik).includes(PESEL));
});

test('Pipeline: model w filtrze wstępnym może zablokować dane osoby prywatnej', async () => {
  const wynik = await uruchomPipeline(
    { tekst: 'Anna Nowak z Radomia choruje na raka i ukrywa to przed pracodawcą.' },
    {
      model1Impl: async (d) => d.tekst,
      filtrImpl: async () => ({ przepuscic: false, kategoria: 'dane_osobowe', opis: 'dane osobowe', powod: 'osoba prywatna + zdrowie' }),
      researchImpl: async () => ({}),
      weryfikatorImpl: async () => ({}),
    }
  );
  assert.equal(wynik.werdykt_ogolny, 'Zablokowano: dane osobowe');
  assert.equal(wynik.filtr_wstepny.metoda, 'model');
});
