try {
  process.loadEnvFile(require('node:path').join(__dirname, '.env'));
} catch {
  // brak .env - działamy na zmiennych środowiskowych / domyślnych
}

const express = require('express');
const { DetectorError, detectAiImage, MODEL_NAME } = require('./detector');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const LLAMA_SERVER_URL = (process.env.LLAMA_SERVER_URL || 'http://konrad:8080').replace(/\/+$/, '');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', async (req, res) => {
  let llamaOk = false;
  let mediaMarker = false;
  let error = null;
  try {
    const r = await fetch(`${LLAMA_SERVER_URL}/props`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const props = await r.json();
      llamaOk = true;
      mediaMarker = Boolean(props?.media_marker);
    } else {
      error = `HTTP ${r.status}`;
    }
  } catch (err) {
    error = err.message;
  }

  res.status(llamaOk && mediaMarker ? 200 : 503).json({
    status: llamaOk && mediaMarker ? 'ok' : 'degraded',
    model: MODEL_NAME,
    llama_server_url: LLAMA_SERVER_URL,
    llama_server_reachable: llamaOk,
    multimodal_ready: mediaMarker,
    ...(error ? { error } : {}),
  });
});

// POST /api/detect-ai
// Body: { "image": "<base64 lub data:image/...;base64,...>", "crops": 3 }
app.post('/api/detect-ai', async (req, res) => {
  const body = req.body || {};
  const image = body.image ?? body.zdjecie ?? body.base64;
  const crops = body.crops !== undefined ? Number(body.crops) : undefined;

  const result = await detectAiImage(image, { serverUrl: LLAMA_SERVER_URL, crops });
  res.json(result);
});

app.use((err, req, res, next) => {
  if (err instanceof DetectorError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Nieprawidłowy JSON.', code: 'INVALID_JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Zapytanie przekracza limit 25 MB.', code: 'PAYLOAD_TOO_LARGE' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Błąd wewnętrzny serwera.' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`[ai-image-detector] Działa na http://localhost:${PORT}`);
    console.log(`[ai-image-detector] Cel llama-server: ${LLAMA_SERVER_URL}`);
  });
}

module.exports = app;
