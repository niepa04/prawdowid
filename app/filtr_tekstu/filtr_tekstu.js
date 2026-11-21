// filtr_tekstu.js - zamienia każdy rodzaj wejścia (tekst, linki, zdjęcia, film) na tekst
//
// Każda metoda przyjmuje dane już po walidacji z dodatki/zabezpieczenia.js
// i zwraca Promise<string>. Każda metoda sama przepuszcza swój wynik
// przez zabezpieczenie (szybkaWeryfikacja dla tekstu, zabezpiecz dla reszty).

const PROMPT_OCR = require('./prompt_ocr');

const OCR = {
  url: process.env.OCR_URL || 'http://100.127.211.111:11434/api/generate',
  model: process.env.OCR_MODEL || 'glm-ocr:latest',
  maxProb: 3, // 1 próba + 2 powtórki
  timeoutMs: Number(process.env.OCR_TIMEOUT_MS) || 180000,
};

// Błąd, którego treść można pokazać klientowi (obslugaBledow zwróci status + wiadomość)
class BladKonwersji extends Error {
  constructor(wiadomosc, status = 502) {
    super(wiadomosc);
    this.status = status;
    this.publiczny = true;
  }
}

const filtrTekstu = {
  // Główne wejście: wybiera właściwą konwersję po typie danych
  async konwertuj(typ, dane) {
    switch (typ) {
      case 'tekst':
        return this.zTekstu(dane);
      case 'link':
        return this.zLinkow(dane);
      case 'zdjecie':
        return this.zeZdjec(dane);
      case 'film':
        return this.zFilmu(dane);
      default:
        throw new Error(`Nieznany typ danych: ${typ}`);
    }
  },

  // Szybka weryfikacja tekstu wpisanego przez użytkownika.
  // tekst: string -> string
  async szybkaWeryfikacja(tekst) {
    // TODO: szybkie sprawdzenie bezpieczeństwa, na razie przepuszcza wszystko
    return tekst;
  },

  // Pełne sprawdzenie tekstu z zewnętrznych źródeł (strony, OCR, filmy):
  // SQL injection, spam, inne niebezpieczne treści.
  // tekst: string -> string (bezpieczny tekst)
  async zabezpiecz(tekst) {
    // TODO: sprawdzanie SQL injection
    // TODO: wykrywanie spamu
    return tekst;
  },

  // tekst: string -> string
  async zTekstu(tekst) {
    return this.szybkaWeryfikacja(tekst);
  },

  // linki: string[] (adresy URL) -> tekst ze wszystkich stron
  async zLinkow(linki) {
    // TODO
    return '';
  },

  // zdjecia: { typ, rozmiar, base64 }[] -> tekst odczytany ze zdjęć
  // Zdjęcia idą do OCR po kolei (jeden serwer modelu, równoległe zapytania tylko by się kolejkowały).
  // Każdy wynik przechodzi przez zabezpiecz(). Przy kilku zdjęciach teksty są oznaczone [ZDJĘCIE n].
  async zeZdjec(zdjecia) {
    const teksty = [];
    for (let i = 0; i < zdjecia.length; i++) {
      const odczyt = await this.ocrZdjecia(zdjecia[i].base64, i + 1);
      teksty.push(await this.zabezpiecz(odczyt));
    }
    if (teksty.length === 1) return teksty[0];
    return teksty.map((t, i) => `[ZDJĘCIE ${i + 1}]\n${t}`).join('\n\n');
  },

  // Wysyła jedno zdjęcie do modelu OCR. Gdy "done" jest false albo zapytanie się nie uda,
  // próbuje jeszcze 2 razy. Po 3 nieudanych próbach rzuca BladKonwersji.
  // base64: string (bez prefiksu data:) -> string (odczytany tekst)
  async ocrZdjecia(base64, numer = 1) {
    let ostatniBlad;
    for (let proba = 1; proba <= OCR.maxProb; proba++) {
      try {
        const odp = await fetch(OCR.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OCR.model,
            prompt: PROMPT_OCR,
            images: [base64],
            stream: false,
          }),
          signal: AbortSignal.timeout(OCR.timeoutMs),
        });
        if (!odp.ok) {
          throw new Error(`HTTP ${odp.status}`);
        }
        const dane = await odp.json();
        if (dane.done === true && typeof dane.response === 'string') {
          return dane.response;
        }
        throw new Error(`done=${dane.done}${dane.done_reason ? `, powód: ${dane.done_reason}` : ''}`);
      } catch (err) {
        ostatniBlad = err;
        console.warn(`OCR zdjęcia nr ${numer}, próba ${proba}/${OCR.maxProb} nieudana: ${err.message}`);
      }
    }
    throw new BladKonwersji(
      `Nie udało się odczytać tekstu ze zdjęcia nr ${numer} po ${OCR.maxProb} próbach (${ostatniBlad.message}).`
    );
  },

  // film: format wejścia jeszcze do ustalenia
  async zFilmu(film) {
    // TODO
    return '';
  },
};

module.exports = filtrTekstu;
module.exports.BladKonwersji = BladKonwersji;
