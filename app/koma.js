// koma.js - serwer aplikacji
const express = require('express');
const { walidujZapytanie, obslugaBledow } = require('./dodatki/zabezpieczenia');
const filtrTekstu = require('./filtr_tekstu/filtr_tekstu');

const os = require('os');

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
const path = require('path');
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'test.html'));
});


// POST /api/weryfikuj  body (JSON), każde pole opcjonalne, przynajmniej jedno niepuste:
// {
//   "tekst":   "dowolny tekst, może zawierać linki i wklejone zdjęcia data:image/...;base64,...",
//   "linki":   "https://..." albo ["https://...", ...],
//   "zdjecia": "<base64>"    albo ["<base64>", ...],
//   "film":    null (jeszcze nieobsługiwany)
// }
// Odpowiedź: { "tekst": "jeden długi, przefiltrowany tekst" }
app.post('/api/weryfikuj', jsonZapytanie, async (req, res) => {
  const dane = walidujZapytanie(req.body);
  const tekst = await filtrTekstu.konwertuj(dane);

  // TEST: wypisuje tekst z filtra w konsoli serwera
  console.log(`\n----- tekst z zapytania -----\n${tekst}\n----- koniec -----`);
  // TODO: dalsze przetwarzanie tekstu

  res.json({ tekst });
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

app.listen(PORT, HOST, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    const ts = adresyTailscale();
    if (ts.length) {
      ts.forEach((ip) => console.log(`Tailscale:          http://${ip}:${PORT}`));
    } else {
      console.log('Nie wykryto adresu Tailscale - czy Tailscale jest włączony?');
    }
  }
});
