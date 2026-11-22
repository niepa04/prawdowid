// dziennikSprawdzen.js - ZAPIS PRZEBIEGU każdego sprawdzenia (wymóg MVP: pytanie, czas, źródła, wynik)
// oraz prosty LIMIT ZAPYTAŃ na adres IP.
//
// Dziennik: plik JSONL (jedna linia = jedno sprawdzenie), domyślnie backend/dane/dziennik_sprawdzen.jsonl.
// Retencja: wpisy starsze niż DZIENNIK_RETENCJA_DNI są usuwane (przy starcie i raz na dobę).
// Usunięcie sesji: DELETE /api/sprawdzenia/:id usuwa wpis o danym id (id wraca w odpowiedzi jako id_sprawdzenia).
// Zgłoszenia zablokowane przez filtr danych osobowych są zapisywane BEZ treści.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DZIENNIK_SCIEZKA, DZIENNIK_RETENCJA_DNI, LIMIT_ZAPYTAN_NA_MINUTE } = require('../../config/ustawienia');

const MAX_PYTANIE = 1000;

function utworzDziennik({ sciezka = DZIENNIK_SCIEZKA, retencjaDni = DZIENNIK_RETENCJA_DNI } = {}) {
  fs.mkdirSync(path.dirname(sciezka), { recursive: true });

  const wczytaj = () => {
    if (!fs.existsSync(sciezka)) return [];
    return fs
      .readFileSync(sciezka, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  };
  const zapiszWszystko = (wpisy) => fs.writeFileSync(sciezka, wpisy.map((w) => JSON.stringify(w)).join('\n') + (wpisy.length ? '\n' : ''));

  function zapisz(body, wynik, { kanal = 'www', czasMs = 0 } = {}) {
    const zablokowane = JSON.stringify(wynik?.security_flags || wynik?.metadane || {}).includes('personal_data') ||
      JSON.stringify(wynik || {}).includes('"type":"personal_data"');
    const pytanie = zablokowane
      ? '[usunięto: dane osobowe]'
      : String(body?.tekst || body?.url || (body?.obraz || body?.zdjecie ? '[zdjęcie]' : '')).slice(0, MAX_PYTANIE);
    const twierdzenia = wynik?.demagog?.twierdzenia || [];
    const zrodla = [];
    for (const t of twierdzenia) {
      for (const z of t.uzyte_zrodla || []) {
        if (z.url && !zrodla.some((x) => x.url === z.url)) zrodla.push({ tytul: z.title, wydawca: z.publisher, data: z.published_at || null, url: z.url });
      }
    }
    const wpis = {
      id: crypto.randomUUID(),
      czas: new Date().toISOString(),
      kanal,
      pytanie,
      wynik: wynik?.werdykt_ogolny || null,
      status: wynik?.status || null,
      czas_ms: czasMs,
      tezy: twierdzenia.map((t) => ({ teza: t.claim, werdykt: t.werdykt })),
      zrodla,
      zdarzenia_bezpieczenstwa: wynik?.research?.security_flags || wynik?.security_flags || [],
    };
    fs.appendFileSync(sciezka, JSON.stringify(wpis) + '\n');
    return wpis.id;
  }

  function usun(id) {
    const wpisy = wczytaj();
    const pozostale = wpisy.filter((w) => w.id !== id);
    if (pozostale.length === wpisy.length) return false;
    zapiszWszystko(pozostale);
    return true;
  }

  function wyczyscStare(teraz = Date.now()) {
    const granica = teraz - retencjaDni * 24 * 3600 * 1000;
    const wpisy = wczytaj();
    const pozostale = wpisy.filter((w) => Date.parse(w.czas) >= granica);
    if (pozostale.length !== wpisy.length) zapiszWszystko(pozostale);
    return wpisy.length - pozostale.length;
  }

  return { zapisz, usun, wyczyscStare, wczytaj, sciezka };
}

// Limit zapytań: okno 1 minuty na adres IP (w pamięci). Po przekroczeniu - 429 z jasnym komunikatem.
function limitZapytan({ naMinute = LIMIT_ZAPYTAN_NA_MINUTE } = {}) {
  const licznik = new Map();
  return (req, res, next) => {
    const teraz = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'nieznany';
    // Boty (Discord, Messenger) działają na tym samym serwerze i obsługują wielu użytkowników z jednego adresu
    if (/^(127\.|::1$|::ffff:127\.)/.test(ip)) return next();
    const w = licznik.get(ip);
    if (!w || teraz - w.start > 60000) {
      licznik.set(ip, { start: teraz, ile: 1 });
      if (licznik.size > 10000) for (const [k, v] of licznik) if (teraz - v.start > 60000) licznik.delete(k);
      return next();
    }
    if (++w.ile > naMinute) {
      res.set('Retry-After', String(Math.ceil((w.start + 60000 - teraz) / 1000)));
      return res.status(429).json({ blad: 'Za dużo sprawdzeń w krótkim czasie. Spróbuj ponownie za minutę.' });
    }
    next();
  };
}

module.exports = { utworzDziennik, limitZapytan };
