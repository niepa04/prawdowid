// zabezpieczenia.js - walidacja i czyszczenie danych wejściowych
//
// Ochrona przed SQL injection działa tu na dwóch poziomach:
// 1. Tutaj: dane wejściowe mają ściśle określony typ, długość i format.
//    Wszystko, co nie pasuje, jest odrzucane, zanim dotrze dalej.
// 2. W warstwie bazy (kiedy powstanie): ZAWSZE zapytania parametryzowane,
//    np. db.query('SELECT * FROM t WHERE id = ?', [id]).
//    Nigdy nie sklejamy SQL-a z tekstem od użytkownika.
//
// Nie blokujemy słów typu "SELECT" czy "DROP" w tekście, bo aplikacja
// weryfikuje dowolne teksty i takie słowa mogą się w nich legalnie pojawić.

const LIMITY = {
  tekstMaxZnakow: 50000,
  linkMaxZnakow: 2048,
  maxLinkow: 20,
  maxZdjec: 10,
  zdjecieMaxBajtow: 5 * 1024 * 1024, // 5 MB po zdekodowaniu
};

class BladWalidacji extends Error {
  constructor(wiadomosc) {
    super(wiadomosc);
    this.status = 400;
  }
}

// Usuwa bajty zerowe i znaki sterujące (zostawia \n, \r, \t)
function wyczyscTekst(tekst) {
  return tekst.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

// Przyjmuje pojedynczą wartość albo tablicę, zwraca zawsze tablicę
function jakoTablica(wartosc) {
  return Array.isArray(wartosc) ? wartosc : [wartosc];
}

function walidujTekst(tekst) {
  if (typeof tekst !== 'string') {
    throw new BladWalidacji('Wyślij tekst w body zapytania.');
  }
  const czysty = wyczyscTekst(tekst);
  if (czysty.length === 0) {
    throw new BladWalidacji('Tekst jest pusty.');
  }
  if (czysty.length > LIMITY.tekstMaxZnakow) {
    throw new BladWalidacji(`Tekst może mieć najwyżej ${LIMITY.tekstMaxZnakow} znaków.`);
  }
  return czysty;
}

function walidujLinki(wejscie) {
  if (wejscie === undefined || wejscie === null) {
    throw new BladWalidacji('Brak pola "linki".');
  }
  const linki = jakoTablica(wejscie);
  if (linki.length === 0 || linki.length > LIMITY.maxLinkow) {
    throw new BladWalidacji(`Podaj od 1 do ${LIMITY.maxLinkow} linków.`);
  }
  return linki.map((link, i) => {
    if (typeof link !== 'string' || link.length > LIMITY.linkMaxZnakow) {
      throw new BladWalidacji(`Link nr ${i + 1} jest nieprawidłowy.`);
    }
    let url;
    try {
      url = new URL(wyczyscTekst(link));
    } catch {
      throw new BladWalidacji(`Link nr ${i + 1} nie jest poprawnym adresem URL.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BladWalidacji(`Link nr ${i + 1} musi zaczynać się od http:// lub https://.`);
    }
    return url.href;
  });
}

const WZOR_DATA_URI = /^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,/i;
const WZOR_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function walidujZdjecia(wejscie) {
  if (wejscie === undefined || wejscie === null) {
    throw new BladWalidacji('Brak pola "zdjecia".');
  }
  const zdjecia = jakoTablica(wejscie);
  if (zdjecia.length === 0 || zdjecia.length > LIMITY.maxZdjec) {
    throw new BladWalidacji(`Podaj od 1 do ${LIMITY.maxZdjec} zdjęć.`);
  }
  return zdjecia.map((zdjecie, i) => {
    if (typeof zdjecie !== 'string') {
      throw new BladWalidacji(`Zdjęcie nr ${i + 1} musi być tekstem Base64.`);
    }
    const dopasowanie = zdjecie.match(WZOR_DATA_URI);
    const typ = dopasowanie ? dopasowanie[1].toLowerCase() : null;
    const dane = zdjecie.replace(WZOR_DATA_URI, '').replace(/\s/g, '');

    if (dane.length === 0 || dane.length % 4 !== 0 || !WZOR_BASE64.test(dane)) {
      throw new BladWalidacji(`Zdjęcie nr ${i + 1} nie jest poprawnym Base64.`);
    }
    const rozmiar = Buffer.byteLength(dane, 'base64');
    if (rozmiar > LIMITY.zdjecieMaxBajtow) {
      throw new BladWalidacji(`Zdjęcie nr ${i + 1} jest większe niż 5 MB.`);
    }
    return { typ, rozmiar, base64: dane };
  });
}

// Puste pole = brak pola: undefined, null, '', [] albo sam whitespace
function pustePole(wartosc) {
  if (wartosc === undefined || wartosc === null) return true;
  if (typeof wartosc === 'string') return wartosc.trim() === '';
  if (Array.isArray(wartosc)) return wartosc.length === 0;
  return false;
}

// Pole musi być napisem albo tablicą napisów; zwraca tablicę (pustą dla pustego pola)
function listaNapisow(wartosc, nazwa) {
  if (pustePole(wartosc)) return [];
  const lista = jakoTablica(wartosc);
  if (!lista.every((x) => typeof x === 'string')) {
    throw new BladWalidacji(`Pole "${nazwa}" musi być tekstem albo listą tekstów.`);
  }
  return lista;
}

// Sprawdza kształt zbiorczego zapytania:
// { "tekst": "...", "linki": [...], "zdjecia": [...], "film": ... }
// Wszystkie pola są opcjonalne. Pole "tekst" może zawierać wklejone linki i zdjęcia
// (data:image/...;base64,...), dlatego jego długość i treść są sprawdzane dopiero
// po rozdzieleniu w filtrTekstu.rozdziel().
// Zwraca { tekst: string, linki: string[], zdjecia: string[] }.
function walidujZapytanie(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BladWalidacji('Wyślij obiekt JSON z polami: tekst, linki, zdjecia.');
  }
  if (!pustePole(body.film)) {
    const blad = new BladWalidacji('Pole "film" nie jest jeszcze obsługiwane.');
    blad.status = 501;
    throw blad;
  }
  if (!pustePole(body.tekst) && typeof body.tekst !== 'string') {
    throw new BladWalidacji('Pole "tekst" musi być tekstem.');
  }
  return {
    tekst: pustePole(body.tekst) ? '' : body.tekst,
    linki: listaNapisow(body.linki, 'linki'),
    zdjecia: listaNapisow(body.zdjecia, 'zdjecia'),
  };
}

// Middleware: zamienia błędy walidacji i błędy parsowania JSON na odpowiedź 400/413
function obslugaBledow(err, req, res, next) {
  if (err instanceof BladWalidacji || err.publiczny) {
    return res.status(err.status).json({ blad: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ blad: 'Nieprawidłowy JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ blad: 'Za duże dane.' });
  }
  console.error(err);
  return res.status(500).json({ blad: 'Błąd serwera.' });
}

module.exports = {
  LIMITY,
  BladWalidacji,
  walidujTekst,
  walidujLinki,
  walidujZdjecia,
  walidujZapytanie,
  obslugaBledow,
};
