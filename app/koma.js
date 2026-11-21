// koma.js - serwer aplikacji
const express = require('express');
const {
  walidujTekst,
  walidujLinki,
  walidujZdjecia,
  obslugaBledow,
} = require('./dodatki/zabezpieczenia');

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

// Limity rozmiaru body: mały dla tekstu i linków, duży tylko dla zdjęć
const jsonMaly = express.json({ limit: '200kb', strict: true });
const jsonZdjecia = express.json({ limit: '70mb', strict: true });

app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'prawdowid' });
});

// POST /api/tekst  body: { "tekst": "..." }
app.post('/api/tekst', jsonMaly, (req, res) => {
  const tekst = walidujTekst(req.body.tekst);

  // TODO: analiza tekstu

  res.json({ tekst });
});

// POST /api/link  body: { "linki": "https://..." } albo { "linki": ["https://...", ...] }
app.post('/api/link', jsonMaly, (req, res) => {
  const linki = walidujLinki(req.body.linki);

  // TODO: analiza linków

  res.json({ linki });
});

// POST /api/zdjecie  body: { "zdjecia": "<base64>" } albo { "zdjecia": ["<base64>", ...] }
app.post('/api/zdjecie', jsonZdjecia, (req, res) => {
  const zdjecia = walidujZdjecia(req.body.zdjecia);

  // TODO: analiza zdjęć

  res.json({ zdjecia: zdjecia.map(({ typ, rozmiar }) => ({ typ, rozmiar })) });
});

// POST /api/film  - na razie pusty
app.post('/api/film', (req, res) => {
  res.status(501).json({ blad: 'Jeszcze nie zaimplementowane.' });
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
