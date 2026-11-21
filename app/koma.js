// koma.js - serwer aplikacji
const express = require('express');
const {
  walidujTekst,
  walidujLinki,
  walidujZdjecia,
  obslugaBledow,
} = require('./dodatki/zabezpieczenia');
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

// Limity rozmiaru body: mały dla tekstu i linków, duży tylko dla zdjęć
const jsonMaly = express.json({ limit: '200kb', strict: true });
const jsonZdjecia = express.json({ limit: '70mb', strict: true });

// TEST: tymczasowy frontend, usunąć razem z plikiem test.html
const path = require('path');
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'test.html'));
});


// TEST: wypisuje tekst z filtra w konsoli serwera
function pokazTekst(zrodlo, tekst) {
  console.log(`\n----- tekst z: ${zrodlo} -----\n${tekst}\n----- koniec -----`);
}

// Surowy tekst w body, bez JSON-a. Przyjmuje każdy Content-Type, domyślnie UTF-8.
const surowyTekst = express.text({ limit: '200kb', type: () => true, defaultCharset: 'utf-8' });

// POST /api/tekst  body: dowolny tekst (string)
app.post('/api/tekst', surowyTekst, async (req, res) => {
  const tekst = walidujTekst(req.body);
  const wynik = await filtrTekstu.konwertuj('tekst', tekst);

  pokazTekst('tekst', wynik); // TODO: dalsze przetwarzanie tekstu

  res.json({ status: 'ok' });
});


app.post('/api/link', jsonMaly, async (req, res) => {
  const linki = walidujLinki(req.body.linki);
  const wynik = await filtrTekstu.konwertuj('link', linki);

  pokazTekst('link', wynik); // TODO: dalsze przetwarzanie tekstu

  res.json({ status: 'ok' });
});


app.post('/api/zdjecie', jsonZdjecia, async (req, res) => {
  const zdjecia = walidujZdjecia(req.body.zdjecia);
  const wynik = await filtrTekstu.konwertuj('zdjecie', zdjecia);

  pokazTekst('zdjecie', wynik); // TODO: dalsze przetwarzanie tekstu

  res.json({ status: 'ok' });
});


app.post('/api/film', (req, res) => {
  // TODO: walidacja filmu, potem filtrTekstu.konwertuj('film', ...)
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
