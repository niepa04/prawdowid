// nierozstrzygniete.js - pętla informacji: rejestr spraw, których Koma nie umiała rozstrzygnąć.
//
// Każde twierdzenie z werdyktem "Brak wystarczających dowodów" trafia do rejestru (plik JSON).
// To samo twierdzenie zgłoszone ponownie (także innymi wielkimi literami czy interpunkcją)
// nie tworzy nowej sprawy, tylko zwiększa licznik zgłoszeń - deduplikacja po znormalizowanej treści.
// Rejestr pozwala zespołowi zobaczyć, czego system nie umie sprawdzić, i uzupełnić źródła.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOMYSLNY_PLIK = path.join(__dirname, '..', 'data', 'nierozstrzygniete.json');
const plikRejestru = () => process.env.KOMA_REJESTR_NIEROZSTRZYGNIETYCH || DOMYSLNY_PLIK;

// "Czy W Polsce spadło 1000 bomb?!" i "w polsce spadło 1000 bomb" to ta sama sprawa
function kluczSprawy(tekst) {
  const norm = String(tekst || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/^\s*(czy|słyszałem|słyszałam|podobno)[,\s]+(że\s+)?/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

function wczytaj() {
  try {
    const dane = JSON.parse(fs.readFileSync(plikRejestru(), 'utf8'));
    return Array.isArray(dane.sprawy) ? dane : { sprawy: [] };
  } catch {
    return { sprawy: [] };
  }
}

function zapisz(dane) {
  const plik = plikRejestru();
  fs.mkdirSync(path.dirname(plik), { recursive: true });
  const tymczasowy = `${plik}.tmp`;
  fs.writeFileSync(tymczasowy, JSON.stringify(dane, null, 2), 'utf8');
  fs.renameSync(tymczasowy, plik); // zapis atomowy - przerwany zapis nie psuje rejestru
}

/**
 * Dopisuje nierozstrzygnięte twierdzenia do rejestru.
 * @param {Array<{claim: string, werdykt: string, uzasadnienie?: string}>} twierdzenia
 * @returns {{dodane: number, zaktualizowane: number}}
 */
function zarejestrujNierozstrzygniete(twierdzenia, teraz = new Date()) {
  const nowe = (twierdzenia || []).filter((t) => t && t.werdykt === 'Brak wystarczających dowodów' && t.claim);
  if (!nowe.length) return { dodane: 0, zaktualizowane: 0 };

  const dane = wczytaj();
  const poKluczu = new Map(dane.sprawy.map((s) => [s.klucz, s]));
  let dodane = 0;
  let zaktualizowane = 0;
  for (const t of nowe) {
    const klucz = kluczSprawy(t.claim);
    const istniejaca = poKluczu.get(klucz);
    if (istniejaca) {
      istniejaca.liczba_zgloszen += 1;
      istniejaca.ostatnie_zgloszenie = teraz.toISOString();
      zaktualizowane++;
    } else {
      const sprawa = {
        klucz,
        tekst: t.claim,
        status: 'otwarta',
        liczba_zgloszen: 1,
        pierwsze_zgloszenie: teraz.toISOString(),
        ostatnie_zgloszenie: teraz.toISOString(),
        ostatnie_uzasadnienie: String(t.uzasadnienie || '').slice(0, 400),
      };
      dane.sprawy.push(sprawa);
      poKluczu.set(klucz, sprawa);
      dodane++;
    }
  }
  try {
    zapisz(dane);
  } catch {
    // rejestr nie może zatrzymać odpowiedzi dla użytkownika
  }
  return { dodane, zaktualizowane };
}

module.exports = { zarejestrujNierozstrzygniete, kluczSprawy, wczytajRejestr: wczytaj, plikRejestru };
