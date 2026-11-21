// koma.js - główny serwer aplikacji KOMA / PRAWDOWID (Model 1 -> Model 2 -> Model 3)

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
const { obslugaBledow } = require('./dodatki/zabezpieczenia');
const { uruchomPipeline } = require('./pipeline');
const { createSourceRegistry } = require('./model3/sourceRegistry');

const app = express();

// Stały port, żeby adres w sieci Tailscale się nie zmieniał.
// HOST 0.0.0.0 = nasłuch na wszystkich interfejsach, w tym na Tailscale (100.x.y.z).
// Przy "tailscale serve" można ustawić HOST=127.0.0.1, wtedy ruch idzie tylko przez proxy Tailscale.
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');

// "tailscale serve" działa jako lokalne proxy, ufamy tylko nagłówkom X-Forwarded-* z localhosta
app.set('trust proxy', 'loopback');

// Jedno zapytanie może zawierać do 10 zdjęć po 5 MB (w Base64 ~4/3 większe), stąd 70 MB
const jsonZapytanie = express.json({ limit: '70mb', strict: true });

// TEST: tymczasowy frontend, usunąć razem z plikiem test.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'test.html'));
});

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
    pipeline: ['model1', 'model2', 'model3', 'demagog'],
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
// Odpowiedź: { status, tekst, model1, model2, model3, metadane }
// Górny limit czasu na jedno sprawdzenie: zawieszone zapytanie do serwera modeli nie może
// blokować użytkownika w nieskończoność (w teście jedno zapytanie wisiało 7,5 minuty).
const MAX_CZAS_SPRAWDZENIA_MS = Number(process.env.KOMA_MAX_CZAS_MS) || 4 * 60 * 1000;

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
    `[KOMA] /api/weryfikuj -> werdykt="${wynik.werdykt_ogolny}" | status=${wynik.status} | twierdzeń=${wynik.metadane.liczba_twierdzen} | dowodów=${wynik.metadane.liczba_dowodow} | czasy: M1=${wynik.model1.czas_ms}ms M2=${wynik.model2.czas_ms}ms M3=${wynik.model3.czas_ms}ms DEM=${wynik.demagog.czas_ms}ms`
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
    console.log(`Serwer KOMA (Model 1 -> Model 2 -> Model 3) działa na http://localhost:${PORT}`);
    if (HOST === '0.0.0.0') {
      const ts = adresyTailscale();
      if (ts.length) {
        ts.forEach((ip) => console.log(`Tailscale:          http://${ip}:${PORT}`));
      } else {
        console.log('Nie wykryto adresu Tailscale - czy Tailscale jest włączony?');
      }
    }
  });
  // Długi limit czasu dla zapytań zawierających OCR + filtrowanie + Model 2 + Model 3
  server.requestTimeout = 600000;
}

module.exports = app;
