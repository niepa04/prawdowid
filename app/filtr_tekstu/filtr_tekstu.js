// filtr_tekstu.js - zamienia wszystko, co przysłał użytkownik, na jeden przefiltrowany tekst
//
// Kolejność:
// 1. rozdziel()   - z treści użytkownika wyciąga linki i wklejone zdjęcia,
//                   powstaje obiekt { tekst, linki, zdjecia }
// 2. konwersja    - linki -> tekst stron (webscraper), zdjęcia -> tekst (OCR);
//                   pola linki i zdjecia zostają nadpisane tym tekstem
// 3. przefiltruj() - model językowy zostawia z tekstu stron i zdjęć tylko to,
//                   co dotyczy tematu, czyli tekstu wpisanego przez użytkownika
// 4. wynik        - jeden długi tekst: tekst + linki + zdjęcia

const PROMPT_OCR = require('./prompt_ocr');
const { promptFiltra, BRAK_INFORMACJI } = require('./prompt_filtr');
const webscraper = require('./webscraper');
const {
  BladWalidacji,
  walidujTekst,
  walidujLinki,
  walidujZdjecia,
} = require('../dodatki/zabezpieczenia');

// Normalizuje adres Ollamy: akceptuje zarówno bazowy "http://host:11434" jak i pełny ".../api/generate"
function normalizujUrlGenerate(surowyUrl) {
  const bezSlash = String(surowyUrl || '').trim().replace(/\/+$/, '');
  if (/\/api\/generate$/i.test(bezSlash)) return bezSlash;
  return bezSlash.replace(/\/api\/chat$/i, '') + '/api/generate';
}

// Wszystkie modele stoją na tym samym serwerze Ollama
const MODELE = {
  url: normalizujUrlGenerate(process.env.OLLAMA_URL || process.env.OCR_URL || 'http://100.127.211.111:11434'),
  ocr: process.env.OCR_MODEL || 'glm-ocr:latest',
  filtr: process.env.FILTR_MODEL || 'qwen3.5:9b',
  maxProb: 3, // 1 próba + 2 powtórki
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 300000,
  // Ollama domyślnie ucina długie wejście do kilku tysięcy tokenów, a tekst ze stron bywa długi
  kontekstFiltra: Number(process.env.FILTR_NUM_CTX) || 32768,
};

// Zdjęcie wklejone w treść: data:image/png;base64,....
const WZOR_ZDJECIA = /data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}/gi;
// Link w treści: od http(s):// do pierwszej spacji lub nawiasu
const WZOR_LINKU = /https?:\/\/[^\s<>"'`()[\]{}]+/gi;

// Błąd, którego treść można pokazać klientowi (obslugaBledow zwróci status + wiadomość)
class BladKonwersji extends Error {
  constructor(wiadomosc, status = 502) {
    super(wiadomosc);
    this.status = status;
    this.publiczny = true;
  }
}

const filtrTekstu = {
  // Główne wejście.
  // dane: { tekst, linki, zdjecia } z walidujZapytanie() - tekst może zawierać linki i zdjęcia
  // -> string (jeden długi, przefiltrowany tekst)
  async konwertuj(dane) {
    // 1. rozdzielenie
    const czesci = this.rozdziel(dane);
    if (!czesci.tekst && !czesci.linki.length && !czesci.zdjecia.length) {
      throw new BladWalidacji('Nic nie przysłano. Podaj tekst, linki albo zdjęcia.');
    }

    // 2. konwersja na tekst; linki i zdjęcia równolegle, bo idą do różnych serwerów
    const [tekst, tekstLinkow, tekstZdjec] = await Promise.all([
      czesci.tekst ? this.zTekstu(czesci.tekst) : '',
      czesci.linki.length ? this.zLinkow(czesci.linki) : '',
      czesci.zdjecia.length ? this.zeZdjec(czesci.zdjecia) : '',
    ]);
    czesci.tekst = tekst;
    czesci.linki = tekstLinkow;
    czesci.zdjecia = tekstZdjec;

    // 3. filtrowanie po temacie; bez tekstu nie ma tematu, więc nie ma czego filtrować
    if (czesci.tekst) {
      if (czesci.zdjecia) czesci.zdjecia = await this.przefiltruj(czesci.tekst, czesci.zdjecia, 'zdjęć');
      if (czesci.linki) czesci.linki = await this.przefiltruj(czesci.tekst, czesci.linki, 'linków');
    }

    // 4. jeden długi tekst
    return [
      ['TEKST', czesci.tekst],
      ['LINKI', czesci.linki],
      ['ZDJĘCIA', czesci.zdjecia],
    ]
      .filter(([, t]) => t)
      .map(([nazwa, t]) => `===== [${nazwa}] =====\n${t}`)
      .join('\n\n');
  },

  // Rozdziela treść użytkownika na osobne pola.
  // Zdjęcia (data:image/...;base64,...) i linki są wycinane z tekstu, a to, co zostanie, jest tematem.
  // Linki i zdjęcia podane w osobnych polach są dołączane do wyciągniętych z tekstu.
  // dane: { tekst, linki, zdjecia } -> { tekst: string, linki: string[], zdjecia: {typ, rozmiar, base64}[] }
  rozdziel(dane) {
    let tekst = dane.tekst || '';

    const zdjecia = [...(dane.zdjecia || []), ...(tekst.match(WZOR_ZDJECIA) || [])];
    tekst = tekst.replace(WZOR_ZDJECIA, ' ');

    // interpunkcja na końcu linku należy do zdania, nie do adresu
    const linkiZTekstu = [];
    tekst = tekst.replace(WZOR_LINKU, (link) => {
      const koncowka = link.match(/[.,;:!?]+$/)?.[0] || '';
      linkiZTekstu.push(link.slice(0, link.length - koncowka.length));
      return ' ' + koncowka;
    });
    const linki = [...new Set([...(dane.linki || []), ...linkiZTekstu])];

    tekst = tekst
      .replace(/\(\s*\)|\[\s*\]/g, ' ') // puste nawiasy po wyciętych linkach
      .replace(/[ \t]+/g, ' ')
      .replace(/ ([.,;:!?])/g, '$1')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // walidacja każdej części tymi samymi regułami co wcześniej
    return {
      tekst: tekst ? walidujTekst(tekst) : '',
      linki: linki.length ? walidujLinki(linki) : [],
      zdjecia: zdjecia.length ? walidujZdjecia(zdjecia) : [],
    };
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
  // Każda strona idzie przez webscraper, a jej tekst przez zabezpiecz().
  // Przy kilku linkach teksty są oznaczone [LINK n: adres].
  async zLinkow(linki) {
    const teksty = [];
    for (const link of linki) {
      const tekstStrony = await webscraper.pobierz(link);
      teksty.push(await this.zabezpiecz(tekstStrony));
    }
    if (teksty.length === 1) return teksty[0];
    return teksty.map((t, i) => `[LINK ${i + 1}: ${linki[i]}]\n${t}`).join('\n\n');
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

  // base64: string (bez prefiksu data:) -> string (odczytany tekst)
  async ocrZdjecia(base64, numer = 1) {
    return this.zapytajModel(
      { model: MODELE.ocr, prompt: PROMPT_OCR, images: [base64] },
      `OCR zdjęcia nr ${numer}`
    );
  },

  // Zostawia z treści tylko informacje dotyczące tematu.
  // temat: string (tekst użytkownika), tresc: string, skad: opis do logów i błędów
  // -> string (przefiltrowana treść, '' gdy nic nie dotyczy tematu)
  async przefiltruj(temat, tresc, skad) {
    const { system, prompt } = promptFiltra(temat, tresc);
    const wynik = await this.zapytajModel(
      {
        model: MODELE.filtr,
        system,
        prompt,
        think: false, // qwen bez trybu myślenia: szybciej, a w odpowiedzi jest sam wynik
        options: { num_ctx: MODELE.kontekstFiltra, temperature: 0 }, // temperatura 0: bez wymyślania
      },
      `filtrowanie ${skad}`
    );
    if (wynik.includes(BRAK_INFORMACJI) && wynik.length < BRAK_INFORMACJI.length + 20) return '';
    return this.sprawdzWynik(wynik, tresc, skad);
  },

  // Ochrona przed prompt injection: model ma tylko przepisywać, więc każda linia wyniku
  // musi pochodzić z treści źródłowej. Linia przechodzi, gdy jest fragmentem źródła
  // albo gdy co najmniej 90% jej słów występuje w źródle (drobne zmiany modelu).
  // Linie wymyślone przez model, np. po wstrzykniętym poleceniu, są odrzucane.
  // wynik, tresc: string -> string
  sprawdzWynik(wynik, tresc, skad) {
    const normuj = (s) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const zrodlo = normuj(tresc);
    const slowaZrodla = new Set(zrodlo.split(' '));

    const linie = wynik.split('\n');
    const dobre = linie.filter((linia) => {
      const n = normuj(linia);
      if (!n) return false;
      if (zrodlo.includes(n)) return true;
      const slowa = n.split(' ');
      return slowa.filter((s) => slowaZrodla.has(s)).length / slowa.length >= 0.9;
    });

    const odrzucone = linie.filter((l) => normuj(l)).length - dobre.length;
    if (odrzucone > 0) {
      console.warn(`filtrowanie ${skad}: odrzucono ${odrzucone} linii spoza treści źródłowej`);
    }
    return dobre.join('\n');
  },

  // Wspólne wywołanie modelu w Ollamie. Gdy "done" jest false albo zapytanie się nie uda,
  // próbuje jeszcze 2 razy. Po 3 nieudanych próbach rzuca BladKonwersji.
  // zapytanie: pola dla /api/generate (model, prompt, images, ...), opis: do logów i błędów
  // -> string (pole "response")
  async zapytajModel(zapytanie, opis) {
    let ostatniBlad;
    for (let proba = 1; proba <= MODELE.maxProb; proba++) {
      try {
        const odp = await fetch(MODELE.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...zapytanie, stream: false }),
          signal: AbortSignal.timeout(MODELE.timeoutMs),
        });
        if (!odp.ok) {
          throw new Error(`HTTP ${odp.status}`);
        }
        const dane = await odp.json();
        if (dane.done === true && typeof dane.response === 'string') {
          return dane.response.trim();
        }
        throw new Error(`done=${dane.done}${dane.done_reason ? `, powód: ${dane.done_reason}` : ''}`);
      } catch (err) {
        ostatniBlad = err;
        console.warn(`${opis}, próba ${proba}/${MODELE.maxProb} nieudana: ${err.message}`);
      }
    }
    throw new BladKonwersji(`Nieudane ${opis} po ${MODELE.maxProb} próbach (${ostatniBlad.message}).`);
  },

  // film: format wejścia jeszcze do ustalenia
  async zFilmu(film) {
    // TODO
    return '';
  },
};

module.exports = filtrTekstu;
module.exports.BladKonwersji = BladKonwersji;
module.exports.normalizujUrlGenerate = normalizujUrlGenerate;
