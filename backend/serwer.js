// serwer.js - serwer Komy (Express): strona, API /api/weryfikuj i /api/status.
// Sprawdzanie: ekstrakcja treści -> ochrona danych osobowych -> filtr wstępny
//              -> Research Gatherer (+ wyszukiwarka dowodów) -> Weryfikator Prawdy (pipeline.js)
// Ustawienia (port, limity, modele, prompty, źródła): folder config/ w głównym katalogu.

// Ustawienia lokalne (np. GOOGLE_FACTCHECK_API_KEY) z pliku .env w głównym folderze.
// Musi być przed require modułów, bo część z nich czyta zmienne środowiskowe przy wczytaniu.
// Zmienne ustawione w terminalu mają pierwszeństwo przed .env.
try {
  process.loadEnvFile(require('path').join(__dirname, '..', '.env'));
} catch {
  // brak pliku .env - działamy na zmiennych z terminala
}

const express = require('express');
const os = require('os');
const path = require('path');
const { obslugaBledow } = require('./wspolne/zabezpieczenia');
const { uruchomPipeline } = require('./pipeline');
const { createSourceRegistry } = require('./wyszukiwarka_dowodow/sourceRegistry');

const app = express();

// Port, host i limit czasu: config/ustawienia.js.
// HOST 0.0.0.0 = nasłuch na wszystkich interfejsach, w tym na Tailscale (100.x.y.z).
// Przy "tailscale serve" można ustawić HOST=127.0.0.1, wtedy ruch idzie tylko przez proxy Tailscale.
const { PORT, HOST, MAX_CZAS_SPRAWDZENIA_MS } = require('../config/ustawienia');

app.disable('x-powered-by');

// "tailscale serve" działa jako lokalne proxy, ufamy tylko nagłówkom X-Forwarded-* z localhosta
app.set('trust proxy', 'loopback');

// Jedno zapytanie może zawierać do 10 zdjęć po 5 MB (w Base64 ~4/3 większe), stąd 70 MB
const jsonZapytanie = express.json({ limit: '70mb', strict: true });

// Strona Koma (React) zbudowana poleceniem "npm run build" -> front-end/dist.
// Dzięki temu jeden serwer (Express, port 3000) daje i stronę, i API - na ten adres prowadzi
// też przycisk "Otwórz Koma w przeglądarce" w rozszerzeniu. Bez zbudowanej strony pod "/"
// jest krótka informacja, jak ją zbudować.
const FOLDER_STRONY = path.join(__dirname, '..', 'front-end', 'dist');
const stronaZbudowana = require('fs').existsSync(path.join(FOLDER_STRONY, 'index.html'));

if (stronaZbudowana) {
  // index.html bez cache (po "npm run build" przeglądarka od razu dostaje nową wersję);
  // pliki z assets/ mają hash w nazwie, więc mogą być cache'owane
  app.use(
    express.static(FOLDER_STRONY, {
      index: 'index.html',
      setHeaders: (res, sciezka) => {
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(sciezka) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    })
  );
} else {
  app.get('/', (req, res) => {
    res
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>Koma</title>' +
          '<body style="font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.5">' +
          '<h1>Koma – serwer działa</h1><p>Strona nie jest jeszcze zbudowana. W głównym folderze projektu uruchom ' +
          '<code>npm run build</code> i odśwież tę stronę.</p><p>API: <code>POST /api/weryfikuj</code>, ' +
          '<a href="/api/status">/api/status</a></p></body>'
      );
  });
}

// Status serwera i podpiętych modułów
app.get('/api/status', (req, res) => {
  let zrodla = null;
  try {
    const reg = createSourceRegistry();
    zrodla = { lacznie: reg.allSources.length, aktywne: reg.enabledSources.length };
  } catch (err) {
    zrodla = { blad: err.message };
  }
  res.json({
    status: 'ok',
    app: 'prawdowid',
    pipeline: ['ekstrakcja_tresci', 'ochrona_danych_osobowych', 'filtr_wstepny', 'research_gatherer', 'wyszukiwarka_dowodow', 'weryfikator_prawdy'],
    zrodla_oficjalne: zrodla,
  });
});

// POST /api/weryfikuj  body (JSON), każde pole opcjonalne, przynajmniej jedno niepuste:
// {
//   "tekst":   "dowolny tekst, może zawierać linki i wklejone zdjęcia data:image/...;base64,...",
//   "linki":   "https://..." albo ["https://...", ...],
//   "zdjecia": "<base64>"    albo ["<base64>", ...],
//   "film":    null (jeszcze nieobsługiwany)
// }
// Odpowiedź: { status, werdykt_ogolny, tekst, model1, research, demagog (werdykty), metadane }
// Górny limit czasu na jedno sprawdzenie (MAX_CZAS_SPRAWDZENIA_MS, config/ustawienia.js): zawieszone
// zapytanie do serwera modeli nie może blokować użytkownika w nieskończoność.

app.post('/api/weryfikuj', jsonZapytanie, async (req, res) => {
  let stoper;
  const limit = new Promise((_, odrzuc) => {
    stoper = setTimeout(() => {
      const blad = new Error('Sprawdzanie trwało zbyt długo (serwer modeli jest przeciążony). Spróbuj ponownie za chwilę.');
      blad.status = 504;
      blad.publiczny = true;
      odrzuc(blad);
    }, MAX_CZAS_SPRAWDZENIA_MS);
  });
  let wynik;
  try {
    wynik = await Promise.race([uruchomPipeline(req.body), limit]);
  } finally {
    clearTimeout(stoper);
  }

  console.log(
    `[KOMA] /api/weryfikuj -> werdykt="${wynik.werdykt_ogolny}" | status=${wynik.status} | tez=${wynik.metadane.liczba_twierdzen} | materiałów=${wynik.metadane.liczba_dowodow} | czasy: M1=${wynik.model1.czas_ms}ms RESEARCH=${wynik.research?.czas_ms ?? 0}ms WERYFIKATOR=${wynik.demagog?.czas_ms ?? 0}ms`
  );

  res.json(wynik);
});

app.use((req, res) => {
  res.status(404).json({ blad: 'Nie znaleziono.' });
});

app.use(obslugaBledow);

// Adresy Tailscale mieszczą się w zakresie 100.64.0.0/10
function adresyTailscale() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
    .filter((ip) => {
      const [a, b] = ip.split('.').map(Number);
      return a === 100 && b >= 64 && b <= 127;
    });
}

if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Serwer KOMA działa na http://localhost:${PORT}`);
    console.log(stronaZbudowana
      ? 'Strona Koma: zbudowana wersja z front-end/dist (po zmianach we frontendzie: npm run build)'
      : 'Strona Koma nie jest zbudowana - zbuduj ją: npm run build');
    if (HOST === '0.0.0.0') {
      const ts = adresyTailscale();
      if (ts.length) {
        ts.forEach((ip) => console.log(`Tailscale:          http://${ip}:${PORT}`));
      } else {
        console.log('Nie wykryto adresu Tailscale - czy Tailscale jest włączony?');
      }
    }
  });
  // Limit połączenia musi być dłuższy niż limit samego sprawdzania (OCR + research + weryfikator)
  server.requestTimeout = MAX_CZAS_SPRAWDZENIA_MS + 2 * 60 * 1000;
}

module.exports = app;
