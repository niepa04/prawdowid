const axios = require('axios');

const DEFAULT_KOMA_API_URL = 'http://localhost:3000';
const STATUS_TIMEOUT_MS = 5000;
const VERIFY_TIMEOUT_MS = 600000; // Zgodne z server.requestTimeout w prawdowid/app/koma.js
const MAX_TEXT_LENGTH = 50000; // Zgodne z LIMITY.tekstMaxZnakow w zabezpieczenia.js
const MAX_LINKS = 20; // Zgodne z LIMITY.maxLinkow w zabezpieczenia.js
const MAX_LINK_LENGTH = 2048; // Zgodne z LIMITY.linkMaxZnakow w zabezpieczenia.js
const MAX_IMAGES = 10; // Zgodne z LIMITY.maxZdjec w zabezpieczenia.js
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB - zgodne z LIMITY.zdjecieMaxBajtow
const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

class KomaApiError extends Error {
  /**
   * @param {string} message - Czytelny komunikat błędu dla użytkownika.
   * @param {object} [details]
   */
  constructor(message, { code = 'KOMA_API_ERROR', status = null, etap = null, backendCode = null } = {}) {
    super(message);
    this.name = 'KomaApiError';
    this.code = code;
    this.status = status;
    this.etap = etap;
    this.backendCode = backendCode;
  }
}

/**
 * Waliduje i normalizuje bazowy adres backendu KOMA wyłącznie ze zmiennej środowiskowej.
 * @param {string} rawUrl
 * @returns {string}
 */
function resolveBackendBaseUrl(rawUrl) {
  const candidate = (rawUrl || DEFAULT_KOMA_API_URL).trim();
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Nieprawidłowy adres KOMA_API_URL w konfiguracji: "${candidate}".`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`KOMA_API_URL musi używać protokołu http:// lub https:// (otrzymano: ${parsed.protocol}).`);
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

const baseURL = resolveBackendBaseUrl(process.env.KOMA_API_URL);

const httpClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

/**
 * Zwraca skonfigurowany adres bazowy backendu KOMA (bez sekretów).
 * @returns {string}
 */
function getBackendUrl() {
  return baseURL;
}

/**
 * Sprawdza dostępność backendu KOMA poprzez GET /api/status.
 * @returns {Promise<{ available: boolean, data?: object, error?: string, code?: string }>}
 */
async function checkStatus() {
  try {
    const response = await httpClient.get('/api/status', {
      timeout: STATUS_TIMEOUT_MS,
    });
    const data = response.data;
    if (!data || data.status !== 'ok') {
      return {
        available: false,
        error: 'Backend KOMA odpowiedział, ale nie zgłosił poprawnego statusu.',
        code: 'INVALID_STATUS_RESPONSE',
      };
    }
    return {
      available: true,
      data,
    };
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH') {
      return {
        available: false,
        error: `Nie można połączyć się z backendem KOMA (${err.code}).`,
        code: err.code,
      };
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return {
        available: false,
        error: 'Przekroczono limit czasu podczas sprawdzania statusu backendu KOMA.',
        code: err.code,
      };
    }
    const status = err.response?.status;
    return {
      available: false,
      error: status
        ? `Backend KOMA zwrócił błąd HTTP ${status} na /api/status.`
        : `Błąd połączenia z backendem KOMA: ${err.message}`,
      code: err.code || 'STATUS_ERROR',
    };
  }
}

/**
 * Parsuje i waliduje listę linków podanych jako tekst lub tablica.
 * @param {string|string[]} rawLinks
 * @returns {string[]}
 */
function parseAndValidateLinks(rawLinks) {
  if (!rawLinks) return [];
  const items = Array.isArray(rawLinks)
    ? rawLinks
    : String(rawLinks)
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);

  if (items.length > MAX_LINKS) {
    throw new KomaApiError(`Możesz podać maksymalnie ${MAX_LINKS} linków naraz.`, {
      code: 'INVALID_INPUT',
    });
  }

  return items.map((item, idx) => {
    if (typeof item !== 'string' || item.length > MAX_LINK_LENGTH) {
      throw new KomaApiError(`Link nr ${idx + 1} przekracza dozwoloną długość ${MAX_LINK_LENGTH} znaków.`, {
        code: 'INVALID_INPUT',
      });
    }
    let parsed;
    try {
      parsed = new URL(item);
    } catch {
      throw new KomaApiError(`Link nr ${idx + 1} („${item.slice(0, 60)}”) nie jest poprawnym adresem URL.`, {
        code: 'INVALID_INPUT',
      });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new KomaApiError(`Link nr ${idx + 1} musi zaczynać się od http:// lub https://.`, {
        code: 'INVALID_INPUT',
      });
    }
    return parsed.href;
  });
}

/**
 * Pobiera załącznik graficzny z Discorda i konwertuje go do formatu data:image/...;base64,...
 * wymaganego przez backend KOMA.
 * @param {import('discord.js').Attachment} attachment
 * @returns {Promise<string>}
 */
async function downloadAttachmentAsDataUri(attachment) {
  if (!attachment || !attachment.url) {
    throw new KomaApiError('Nieprawidłowy załącznik graficzny.', { code: 'INVALID_INPUT' });
  }

  if (typeof attachment.size === 'number' && attachment.size > MAX_IMAGE_BYTES) {
    throw new KomaApiError('Załączone zdjęcie jest większe niż maksymalny limit 5 MB.', {
      code: 'INVALID_INPUT',
    });
  }

  const rawMime = (attachment.contentType || '').split(';')[0].trim().toLowerCase();
  let mime = rawMime;
  if (!mime && attachment.name) {
    const ext = attachment.name.split('.').pop()?.toLowerCase();
    const extMap = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
    };
    mime = extMap[ext] || '';
  }

  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    throw new KomaApiError(
      'Nieobsługiwany format zdjęcia. Dozwolone formaty: PNG, JPG, JPEG, WEBP, GIF, BMP.',
      { code: 'INVALID_INPUT' }
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(attachment.url);
  } catch {
    throw new KomaApiError('Nieprawidłowy adres URL załącznika Discord.', { code: 'INVALID_INPUT' });
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new KomaApiError('Adres załącznika musi używać protokołu HTTPS.', { code: 'INVALID_INPUT' });
  }

  try {
    const response = await axios.get(parsedUrl.href, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: MAX_IMAGE_BYTES,
      maxBodyLength: MAX_IMAGE_BYTES,
    });
    const buffer = Buffer.from(response.data);
    if (buffer.length === 0) {
      throw new KomaApiError('Pobrane zdjęcie jest puste.', { code: 'INVALID_INPUT' });
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new KomaApiError('Załączone zdjęcie przekracza limit 5 MB.', { code: 'INVALID_INPUT' });
    }
    const normalizedMime = mime === 'image/jpg' ? 'image/jpeg' : mime;
    return `data:${normalizedMime};base64,${buffer.toString('base64')}`;
  } catch (err) {
    if (err instanceof KomaApiError) throw err;
    throw new KomaApiError(`Nie udało się pobrać załączonego zdjęcia z Discorda: ${err.message}`, {
      code: 'ATTACHMENT_DOWNLOAD_ERROR',
    });
  }
}

/**
 * Wysyła dane (tekst, linki, zdjęcia) do weryfikacji przez endpoint POST /api/weryfikuj.
 * @param {{ tekst?: string, linki?: string[], zdjecia?: string[] }} input
 * @returns {Promise<object>}
 */
async function verifyInput({ tekst = '', linki = [], zdjecia = [] } = {}) {
  const payload = {};

  if (typeof tekst === 'string' && tekst.trim().length > 0) {
    const trimmed = tekst.trim();
    if (trimmed.length > MAX_TEXT_LENGTH) {
      throw new KomaApiError(`Tekst przekracza maksymalny limit ${MAX_TEXT_LENGTH} znaków.`, {
        code: 'INVALID_INPUT',
      });
    }
    payload.tekst = trimmed;
  }

  if (Array.isArray(linki) && linki.length > 0) {
    payload.linki = parseAndValidateLinks(linki);
  }

  if (Array.isArray(zdjecia) && zdjecia.length > 0) {
    if (zdjecia.length > MAX_IMAGES) {
      throw new KomaApiError(`Możesz przesłać maksymalnie ${MAX_IMAGES} zdjęć.`, {
        code: 'INVALID_INPUT',
      });
    }
    payload.zdjecia = zdjecia;
  }

  if (!payload.tekst && !payload.linki && !payload.zdjecia) {
    throw new KomaApiError('Podaj przynajmniej jeden element do weryfikacji: tekst, link lub zdjęcie.', {
      code: 'INVALID_INPUT',
    });
  }

  try {
    const response = await httpClient.post('/api/weryfikuj', payload, {
      timeout: VERIFY_TIMEOUT_MS,
    });
    if (!response.data || typeof response.data !== 'object') {
      throw new KomaApiError('Backend KOMA zwrócił pustą lub nieprawidłową odpowiedź.', {
        code: 'INVALID_RESPONSE',
      });
    }
    return response.data;
  } catch (err) {
    if (err instanceof KomaApiError) throw err;

    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH') {
      throw new KomaApiError(
        'Backend KOMA jest obecnie niedostępny. Upewnij się, że serwer KOMA działa.',
        { code: 'BACKEND_UNAVAILABLE' }
      );
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new KomaApiError(
        'Analiza przekroczyła limit czasu oczekiwania. Spróbuj ponownie z mniejszą ilością danych.',
        { code: 'TIMEOUT' }
      );
    }

    const status = err.response?.status || null;
    const body = err.response?.data;
    const backendMessage = typeof body?.blad === 'string' ? body.blad : null;
    const etap = typeof body?.etap === 'string' ? body.etap : null;
    const backendCode = typeof body?.kod === 'string' ? body.kod : null;

    if (backendMessage) {
      throw new KomaApiError(backendMessage, {
        code: 'BACKEND_ERROR',
        status,
        etap,
        backendCode,
      });
    }

    throw new KomaApiError(
      status
        ? `Backend KOMA zwrócił błąd HTTP ${status}.`
        : `Nieoczekiwany błąd komunikacji z backendem KOMA: ${err.message}`,
      { code: 'HTTP_ERROR', status }
    );
  }
}

/**
 * Zachowana kompatybilność wsteczna dla wywołań z samym tekstem.
 * @param {string} tekst
 * @returns {Promise<object>}
 */
async function verifyText(tekst) {
  return verifyInput({ tekst });
}

module.exports = {
  KomaApiError,
  getBackendUrl,
  checkStatus,
  verifyInput,
  verifyText,
  parseAndValidateLinks,
  downloadAttachmentAsDataUri,
  MAX_TEXT_LENGTH,
  MAX_LINKS,
  MAX_IMAGE_BYTES,
};
