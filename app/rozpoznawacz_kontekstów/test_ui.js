// test_ui.js - Prosta strona WWW do testowania Modelu 2 (oraz Modelu 2 -> Modelu 3)
const express = require('express');
const { model2 } = require('./model2');
const model3 = require('../model3/model3');

const app = express();
const PORT = Number(process.env.TEST_UI_PORT) || 3005;

app.use(express.json({ limit: '2mb' }));

const HTML = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KOMA – Tester Model 2 / Model 3</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    .wrap {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: #f8fafc;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    label {
      font-size: 13px;
      color: #94a3b8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    textarea {
      width: 100%;
      min-height: 220px;
      resize: vertical;
      background: #0f172a;
      color: #f1f5f9;
      border: 1px solid #475569;
      border-radius: 8px;
      padding: 12px;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.5;
    }
    textarea:focus { outline: 2px solid #38bdf8; border-color: transparent; }
    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button:disabled { opacity: 0.55; cursor: wait; }
    .btn-primary { background: #38bdf8; color: #0f172a; }
    .btn-secondary { background: #22c55e; color: #052e16; }
    .btn-ghost { background: #334155; color: #e2e8f0; margin-left: auto; }
    .status {
      font-size: 13px;
      color: #94a3b8;
    }
    pre {
      margin: 0;
      min-height: 260px;
      max-height: 600px;
      overflow: auto;
      background: #020617;
      color: #cbd5e1;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>KOMA – Tester Modelu 2 i Modelu 3</h1>

    <div class="card">
      <label for="inputText">Wejście (wklej dowolny tekst, linki, OCR)</label>
      <textarea id="inputText" placeholder="Wklej tutaj tekst do analizy..."></textarea>
      <div class="actions">
        <button id="btnM2" class="btn-primary">Analizuj (Model 2)</button>
        <button id="btnM23" class="btn-secondary">Analizuj (Model 2 → Model 3)</button>
        <span id="status" class="status">Gotowy.</span>
        <button id="btnCopy" class="btn-ghost" type="button">Kopiuj JSON</button>
      </div>
    </div>

    <div class="card">
      <label for="outputJson">Wyjście (JSON)</label>
      <pre id="outputJson">{}</pre>
    </div>
  </div>

  <script>
    const inputEl = document.getElementById('inputText');
    const outputEl = document.getElementById('outputJson');
    const statusEl = document.getElementById('status');
    const btnM2 = document.getElementById('btnM2');
    const btnM23 = document.getElementById('btnM23');
    const btnCopy = document.getElementById('btnCopy');

    async function run(endpoint, label) {
      const tekst = inputEl.value.trim();
      if (!tekst) {
        statusEl.textContent = 'Wpisz lub wklej najpierw tekst.';
        return;
      }

      btnM2.disabled = true;
      btnM23.disabled = true;
      const start = Date.now();
      const timer = setInterval(() => {
        statusEl.textContent = label + ' trwa... ' + ((Date.now() - start) / 1000).toFixed(1) + ' s';
      }, 200);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tekst }),
        });
        const data = await res.json();
        outputEl.textContent = JSON.stringify(data, null, 2);
        statusEl.textContent = res.ok
          ? 'Zakończono w ' + ((Date.now() - start) / 1000).toFixed(1) + ' s.'
          : 'Błąd HTTP ' + res.status;
      } catch (err) {
        outputEl.textContent = JSON.stringify({ blad: err.message }, null, 2);
        statusEl.textContent = 'Błąd połączenia.';
      } finally {
        clearInterval(timer);
        btnM2.disabled = false;
        btnM23.disabled = false;
      }
    }

    btnM2.addEventListener('click', () => run('/api/model2', 'Model 2'));
    btnM23.addEventListener('click', () => run('/api/model2-i-3', 'Model 2 + Model 3'));
    btnCopy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(outputEl.textContent);
      statusEl.textContent = 'Skopiowano JSON do schowka.';
    });
  </script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.type('html').send(HTML);
});

app.post('/api/model2', async (req, res) => {
  const tekst = typeof req.body?.tekst === 'string' ? req.body.tekst.trim() : '';
  if (!tekst) return res.status(400).json({ blad: 'Pole "tekst" jest puste.' });

  const t0 = Date.now();
  try {
    const wynik = await model2(tekst);
    res.json({ czas_ms: Date.now() - t0, liczba_twierdzen: wynik.claims.length, wynik });
  } catch (err) {
    res.status(500).json({ blad: err.message, kod: err.code || 'MODEL2_ERROR' });
  }
});

app.post('/api/model2-i-3', async (req, res) => {
  const tekst = typeof req.body?.tekst === 'string' ? req.body.tekst.trim() : '';
  if (!tekst) return res.status(400).json({ blad: 'Pole "tekst" jest puste.' });

  const t0 = Date.now();
  try {
    const m2 = await model2(tekst);
    const czasModel2Ms = Date.now() - t0;
    const t1 = Date.now();
    const m3 = await model3(m2);
    const czasModel3Ms = Date.now() - t1;
    res.json({
      czas_model2_ms: czasModel2Ms,
      czas_model3_ms: czasModel3Ms,
      model2: m2,
      model3: m3,
    });
  } catch (err) {
    res.status(500).json({ blad: err.message, kod: err.code || 'PIPELINE_ERROR' });
  }
});

app.listen(PORT, () => {
  console.log(`Tester KOMA działa na http://localhost:${PORT}`);
});
