const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const CROP = 528;
const SIDE = 576;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MODEL_NAME = 'abacusai/Smaug-AI-Image-Detector-GGUF:Q8_0';

const DEFAULT_HEAD = JSON.parse(fs.readFileSync(path.join(__dirname, 'head.json'), 'utf8'));

class DetectorError extends Error {
  constructor(message, { status = 500, code = 'DETECTOR_ERROR' } = {}) {
    super(message);
    this.name = 'DetectorError';
    this.status = status;
    this.code = code;
  }
}

// Akceptuje czysty base64 albo Data URI (data:image/...;base64,...).
function decodeBase64Image(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new DetectorError('Podaj obraz w polu "image" jako base64.', { status: 400, code: 'INVALID_INPUT' });
  }
  const cleaned = input.trim().replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '').replace(/\s+/g, '');
  if (!cleaned || cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    throw new DetectorError('Nieprawidłowy format base64.', { status: 400, code: 'INVALID_BASE64' });
  }
  const buf = Buffer.from(cleaned, 'base64');
  if (!buf.length) {
    throw new DetectorError('Pusty obraz.', { status: 400, code: 'EMPTY_IMAGE' });
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new DetectorError('Obraz przekracza limit 15 MB.', { status: 413, code: 'IMAGE_TOO_LARGE' });
  }
  return buf;
}

// Przygotowuje 1 lub 3 bezstratne wycinki PNG 528x528 zgodnie z treningiem Smaug-AI-Image-Detector.
async function createViews(imageBuffer, crops = 3) {
  if (crops !== 1 && crops !== 3) {
    throw new DetectorError('Parametr "crops" może mieć wartość 1 lub 3.', { status: 400, code: 'INVALID_CROPS' });
  }

  let baseBuf;
  let w;
  let h;
  try {
    const oriented = await sharp(imageBuffer)
      .rotate()
      .removeAlpha()
      .toColorspace('srgb')
      .toBuffer({ resolveWithObject: true });
    baseBuf = oriented.data;
    w = oriented.info.width;
    h = oriented.info.height;
  } catch {
    throw new DetectorError('Nie udało się odczytać obrazu.', { status: 400, code: 'DECODE_FAILED' });
  }

  let pipeline = sharp(baseBuf);
  const minSide = Math.min(w, h);
  if (minSide > SIDE) {
    const s = SIDE / minSide;
    w = Math.max(CROP, Math.round(w * s));
    h = Math.max(CROP, Math.round(h * s));
    pipeline = pipeline.resize(w, h, { fit: 'fill', kernel: 'lanczos3' });
  } else if (minSide < CROP) {
    const s = CROP / minSide;
    w = Math.max(CROP, Math.ceil(w * s));
    h = Math.max(CROP, Math.ceil(h * s));
    pipeline = pipeline.resize(w, h, { fit: 'fill', kernel: 'cubic' });
  }

  const resizedBuf = await pipeline.png().toBuffer();
  const cx = Math.floor((w - CROP) / 2);
  const cy = Math.floor((h - CROP) / 2);

  let coords;
  if (crops === 1) {
    coords = [{ left: cx, top: cy }];
  } else if (w >= h) {
    coords = [0, cx, w - CROP].map((left) => ({ left, top: cy }));
  } else {
    coords = [0, cy, h - CROP].map((top) => ({ left: cx, top }));
  }

  return Promise.all(
    coords.map(({ left, top }) =>
      sharp(resizedBuf)
        .extract({ left, top, width: CROP, height: CROP })
        .png()
        .toBuffer()
    )
  );
}

function scoreEmbedding(embedding, head = DEFAULT_HEAD) {
  if (!Array.isArray(embedding) || embedding.length !== head.weight.length) {
    throw new DetectorError(
      `Nieoczekiwany rozmiar embeddingu (${embedding?.length ?? 0} zamiast ${head.weight.length}).`,
      { status: 502, code: 'INVALID_EMBEDDING' }
    );
  }
  let sum = head.bias;
  for (let i = 0; i < head.weight.length; i++) {
    sum += head.weight[i] * embedding[i];
  }
  return sum;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function classifyProbability(prob) {
  if (prob >= 0.7) return 'ai';
  if (prob >= 0.4) return 'uncertain';
  return 'human';
}

const markerCache = new Map();

async function getMediaMarker(serverUrl, { fetchImpl = fetch, timeoutMs = 15000, forceRefresh = false } = {}) {
  const base = serverUrl.replace(/\/+$/, '');
  if (!forceRefresh && markerCache.has(base)) {
    return markerCache.get(base);
  }
  let res;
  try {
    res = await fetchImpl(`${base}/props`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new DetectorError(
      `Brak połączenia z llama-server pod ${base} (${err.message}).`,
      { status: 503, code: 'SERVER_UNREACHABLE' }
    );
  }
  if (!res.ok) {
    throw new DetectorError(`llama-server /props zwrócił HTTP ${res.status}.`, { status: 502, code: 'PROPS_ERROR' });
  }
  const data = await res.json();
  if (!data?.media_marker) {
    throw new DetectorError('Serwer nie zwrócił pola media_marker (uruchom llama-server z --mmproj).', {
      status: 502,
      code: 'MISSING_MEDIA_MARKER',
    });
  }
  markerCache.set(base, data.media_marker);
  return data.media_marker;
}

async function fetchViewEmbedding(serverUrl, marker, pngBuffer, { fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  const base = serverUrl.replace(/\/+$/, '');
  let res;
  try {
    res = await fetchImpl(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        content: {
          prompt_string: marker,
          multimodal_data: [pngBuffer.toString('base64')],
        },
        embd_normalize: 2,
      }),
    });
  } catch (err) {
    throw new DetectorError(`Błąd połączenia z llama-server /embeddings (${err.message}).`, {
      status: 503,
      code: 'EMBEDDINGS_UNREACHABLE',
    });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new DetectorError(`llama-server /embeddings zwrócił HTTP ${res.status}: ${txt.slice(0, 200)}`, {
      status: 502,
      code: 'EMBEDDINGS_ERROR',
    });
  }
  const payload = await res.json();
  const raw = payload?.[0]?.embedding;
  if (!Array.isArray(raw) || !raw.length) {
    throw new DetectorError('Pusty embedding z llama-server.', { status: 502, code: 'EMPTY_EMBEDDING' });
  }
  return Array.isArray(raw[0]) ? raw[0] : raw;
}

async function detectAiImage(base64Input, options = {}) {
  const started = Date.now();
  const serverUrl = (options.serverUrl || process.env.LLAMA_SERVER_URL || 'http://konrad:8080').replace(/\/+$/, '');
  const crops = options.crops ?? (Number(process.env.DEFAULT_CROPS) || 3);
  const timeoutMs = options.timeoutMs || Number(process.env.REQUEST_TIMEOUT_MS) || 60000;
  const fetchImpl = options.fetchImpl || fetch;
  const head = options.head || DEFAULT_HEAD;

  const imgBuf = decodeBase64Image(base64Input);
  const views = await createViews(imgBuf, crops);
  let marker = await getMediaMarker(serverUrl, { fetchImpl, timeoutMs: Math.min(timeoutMs, 15000) });

  let logits;
  try {
    logits = await Promise.all(
      views.map(async (view) => {
        const emb = await fetchViewEmbedding(serverUrl, marker, view, { fetchImpl, timeoutMs });
        return scoreEmbedding(emb, head);
      })
    );
  } catch (err) {
    // Jeśli serwer llama-server zrestartował się i zmienił losowy media_marker, odśwież raz i ponów.
    if (err.code === 'EMBEDDINGS_ERROR') {
      marker = await getMediaMarker(serverUrl, { fetchImpl, timeoutMs: Math.min(timeoutMs, 15000), forceRefresh: true });
      logits = await Promise.all(
        views.map(async (view) => {
          const emb = await fetchViewEmbedding(serverUrl, marker, view, { fetchImpl, timeoutMs });
          return scoreEmbedding(emb, head);
        })
      );
    } else {
      throw err;
    }
  }

  const avgLogit = logits.reduce((a, b) => a + b, 0) / logits.length;
  const prob = sigmoid(avgLogit);
  const aiPercent = Math.round(prob * 1000) / 10;

  return {
    ai_probability: Number(prob.toFixed(4)),
    ai_percent: aiPercent,
    human_percent: Math.round((100 - aiPercent) * 10) / 10,
    label: classifyProbability(prob),
    crops: views.length,
    model: MODEL_NAME,
    elapsed_ms: Date.now() - started,
  };
}

module.exports = {
  DetectorError,
  decodeBase64Image,
  createViews,
  scoreEmbedding,
  sigmoid,
  classifyProbability,
  detectAiImage,
  MODEL_NAME,
};
