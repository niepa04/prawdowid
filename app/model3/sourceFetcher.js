// sourceFetcher.js - Bezpieczne pobieranie materiałów wyłącznie z zatwierdzonych hostów
const dns = require('node:dns').promises;
const { isPrivateIp } = require('./sourceRegistry');

const WAF_PATTERNS = [
  /\/_Incapsula_Resource/i,
  /incapsula incident id/i,
  /cf-browser-verification/i,
  /attention required!\s*\|\s*cloudflare/i,
  /just a moment\.\.\./i,
  /challenges\.cloudflare\.com/i,
  /g-recaptcha/i,
  /h-captcha/i,
];

const PROMPT_INJECTION_PATTERNS = [
  { id: 'ignore_instructions_en', regex: /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions|prompts|rules)/i },
  { id: 'ignore_instructions_pl', regex: /zignoruj\s+(wszystkie\s+)?(wcześniejsze|poprzednie|powyższe|systemowe)\s+(instrukcje|polecenia|zasady)/i },
  { id: 'override_verdict_pl', regex: /(oznacz|uznaj|zwróć|napisz)\s+(że\s+)?(wszystkie\s+)?(informacje|twierdzenia|to)\s+(są|jest)\s+(prawdziwe|prawdą|fałszywe)/i },
  { id: 'override_verdict_en', regex: /(mark|set|return|declare)\s+(all\s+)?(claims?|this|everything)\s+(as\s+)?(true|verified|confirmed|false)/i },
  { id: 'role_hijack', regex: /(you\s+are\s+now|od\s+teraz\s+jesteś|act\s+as\s+system|new\s+system\s+prompt|nowy\s+prompt\s+systemowy)/i },
  { id: 'exfiltrate_secrets', regex: /(reveal|print|output|ujawnij|wypisz|pokaż)\s+(your\s+)?(system\s+prompt|api\s*key|klucz\s*api|sekret|env|zmienne\s+środowiskowe)/i },
  { id: 'delimiter_escape', regex: /<\/TEKST_DO_ANALIZY>|\[SYSTEM\]|<<SYS>>|<\|im_start\|>system/i },
];

/**
 * Skanuje niezaufaną treść pod kątem prób prompt injection.
 * Zwraca listę wykrytych flag bezpieczeństwa bez modyfikowania promptów systemowych.
 */
function detectPromptInjection(text, url) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const flags = [];
  for (const rule of PROMPT_INJECTION_PATTERNS) {
    const match = text.match(rule.regex);
    if (match) {
      flags.push({
        type: 'prompt_injection_detected',
        rule_id: rule.id,
        url,
        matched_snippet: match[0].slice(0, 120),
        action_taken: 'treated_as_untrusted_data',
      });
    }
  }
  return flags;
}

/**
 * Neutralizuje wzorce przypominające prompt injection w cytowanych fragmentach,
 * nie wymyślając nowych słów – zwraca flagę ostrzegawczą.
 */
function containsPromptInjection(text) {
  if (typeof text !== 'string') return false;
  return PROMPT_INJECTION_PATTERNS.some((rule) => rule.regex.test(text));
}

function detectWafChallenge(html, status) {
  if (typeof html !== 'string' || html.length === 0) return null;
  // Incapsula/Cloudflare strony challenge są krótkie i zawierają charakterystyczne znaczniki
  if (html.length < 15000 || status === 403 || status === 503) {
    for (const pattern of WAF_PATTERNS) {
      if (pattern.test(html)) {
        return `Wykryto ochronę antybotową/WAF (${pattern.source}). Model 3 nie obchodzi zabezpieczeń.`;
      }
    }
  }
  return null;
}

function classifyNetworkError(err) {
  const code = err?.cause?.code || err?.code || '';
  const msg = `${err?.message || ''} ${err?.cause?.message || ''}`;

  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(msg)) {
    return { retrievalStatus: 'timeout', message: 'Przekroczono limit czasu połączenia.' };
  }
  if (
    /CERT_|UNABLE_TO_VERIFY|SELF_SIGNED|TLS|SSL/i.test(code) ||
    /certificate|unable to verify/i.test(msg)
  ) {
    return {
      retrievalStatus: 'tls_error',
      message: `Błąd weryfikacji certyfikatu TLS serwera (${code || 'TLS_ERROR'}).`,
    };
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(code)) {
    return { retrievalStatus: 'dns_error', message: `Nie można rozwiązać nazwy hosta (${code}).` };
  }
  return {
    retrievalStatus: 'network_error',
    message: `Błąd połączenia sieciowego: ${err?.message || 'nieznany błąd'}`,
  };
}

async function readBodyWithLimit(response, maxBytes) {
  const contentLengthHeader = response.headers?.get?.('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes * 4) {
      return {
        text: '',
        bytesRead: 0,
        truncated: true,
        tooLarge: true,
      };
    }
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const raw = await response.text();
    const buf = Buffer.from(raw, 'utf8');
    if (buf.length > maxBytes) {
      return {
        text: buf.subarray(0, maxBytes).toString('utf8'),
        bytesRead: maxBytes,
        truncated: true,
        tooLarge: false,
      };
    }
    return { text: raw, bytesRead: buf.length, truncated: false, tooLarge: false };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (totalBytes + chunk.length > maxBytes) {
        const remaining = maxBytes - totalBytes;
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining));
          totalBytes += remaining;
        }
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(chunk);
      totalBytes += chunk.length;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: Buffer.concat(chunks, totalBytes).toString('utf8'),
    bytesRead: totalBytes,
    truncated,
    tooLarge: false,
  };
}

/**
 * Tworzy bezpieczny fetcher przestrzegający zasad katalogu źródeł, SSRF i limitów.
 */
function createSourceFetcher(sourceRegistry, config, deps = {}) {
  const fetchFn = deps.fetchImpl || fetch;
  const dnsLookupFn =
    deps.dnsLookupImpl !== undefined
      ? deps.dnsLookupImpl
      : deps.fetchImpl
        ? null // W testach z mockowanym fetchImpl nie robimy realnych zapytań DNS, chyba że podano dnsLookupImpl
        : (hostname) => dns.lookup(hostname, { all: true });

  const requestCache = new Map();

  async function verifyDnsNotPrivate(hostname) {
    if (!dnsLookupFn) return { ok: true };
    try {
      const addresses = await dnsLookupFn(hostname);
      const list = Array.isArray(addresses) ? addresses : [addresses];
      for (const item of list) {
        const ip = typeof item === 'string' ? item : item?.address;
        if (ip && isPrivateIp(ip)) {
          return {
            ok: false,
            code: 'SSRF_DNS_PRIVATE_IP',
            reason: `Host "${hostname}" rozwiązuje się na prywatny adres IP (${ip}) – zablokowano SSRF.`,
          };
        }
      }
      return { ok: true };
    } catch {
      // Błąd DNS zostanie obsłużony podczas samego połączenia lub poniżej
      return { ok: true };
    }
  }

  /**
   * Pobiera zasób z URL-a po pełnej walidacji domeny, SSRF i każdego przekierowania.
   */
  async function fetchUrl(targetUrl, fetchOptions = {}) {
    const useCache = fetchOptions.useCache !== false;
    if (useCache && requestCache.has(targetUrl)) {
      return requestCache.get(targetUrl);
    }

    const promise = executeFetch(targetUrl, fetchOptions);
    if (useCache) {
      requestCache.set(targetUrl, promise);
    }
    return promise;
  }

  async function executeFetch(targetUrl, fetchOptions = {}) {
    const retrievedAt = new Date().toISOString();
    const maxRedirects = fetchOptions.maxRedirects ?? config.maxRedirects ?? 5;
    const timeoutMs = fetchOptions.timeoutMs ?? config.timeoutMs ?? 15000;
    const maxDocumentSize = fetchOptions.maxDocumentSize ?? config.maxDocumentSize ?? 2 * 1024 * 1024;
    const securityFlags = [];
    const limitations = [];
    const redirectChain = [];

    let currentUrl = targetUrl;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      // 1. Walidacja domeny i SSRF PRZED wysłaniem żądania
      const urlCheck = sourceRegistry.validateUrl(currentUrl);
      if (!urlCheck.allowed) {
        const isRedirect = hop > 0;
        const flagType =
          urlCheck.code === 'SSRF_BLOCKED'
            ? 'ssrf_blocked'
            : isRedirect
              ? 'redirect_to_untrusted_host_blocked'
              : 'untrusted_host_blocked';

        securityFlags.push({
          type: flagType,
          code: urlCheck.code,
          url: currentUrl,
          initial_url: targetUrl,
          reason: urlCheck.reason,
        });

        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status: null,
          contentType: null,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: isRedirect ? 'redirect_blocked' : urlCheck.code.toLowerCase(),
          error: urlCheck.reason,
          limitations: [urlCheck.reason],
          securityFlags,
        };
      }

      // 2. Dodatkowa kontrola DNS przeciwko DNS rebinding / SSRF na prywatne IP
      const dnsCheck = await verifyDnsNotPrivate(urlCheck.hostname);
      if (!dnsCheck.ok) {
        securityFlags.push({
          type: 'ssrf_blocked',
          code: dnsCheck.code,
          url: currentUrl,
          reason: dnsCheck.reason,
        });
        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status: null,
          contentType: null,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: 'ssrf_blocked',
          error: dnsCheck.reason,
          limitations: [dnsCheck.reason],
          securityFlags,
        };
      }

      // 3. Właściwe żądanie HTTP z redirect: 'manual'
      let response;
      try {
        response = await fetchFn(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'User-Agent': config.userAgent,
            Accept:
              fetchOptions.accept ||
              'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.5',
          },
        });
      } catch (err) {
        const classified = classifyNetworkError(err);
        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status: null,
          contentType: null,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: classified.retrievalStatus,
          error: classified.message,
          limitations: [classified.message],
          securityFlags,
        };
      }

      const status = response.status;
      const location = response.headers?.get?.('location');
      redirectChain.push({ url: currentUrl, status, location: location || null });

      // 4. Obsługa przekierowań 3xx z ponowną weryfikacją hosta w kolejnej iteracji
      if (status >= 300 && status < 400 && location) {
        try {
          currentUrl = new URL(location, currentUrl).href;
        } catch {
          return {
            ok: false,
            url: targetUrl,
            finalUrl: currentUrl,
            status,
            contentType: null,
            body: '',
            retrievedAt,
            redirectChain,
            retrievalStatus: 'invalid_redirect',
            error: `Niepoprawny nagłówek Location w przekierowaniu: ${location}`,
            limitations: ['Niepoprawny adres przekierowania HTTP.'],
            securityFlags,
          };
        }
        continue;
      }

      const contentType = response.headers?.get?.('content-type') || '';

      if (status === 429) {
        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status,
          contentType,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: 'rate_limited',
          error: 'Przekroczono limit zapytań źródła (HTTP 429).',
          limitations: ['Źródło zwróciło limit zapytań HTTP 429.'],
          securityFlags,
        };
      }

      if (status === 401 || status === 403) {
        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status,
          contentType,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: 'access_denied',
          error: `Brak dostępu do zasobu (HTTP ${status}).`,
          limitations: [`Dostęp zablokowany przez serwer (HTTP ${status}).`],
          securityFlags,
        };
      }

      if (status === 404) {
        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status,
          contentType,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: 'not_found',
          error: 'Nie znaleziono zasobu (HTTP 404).',
          limitations: ['Zasób nie istnieje (HTTP 404).'],
          securityFlags,
        };
      }

      if (status >= 500) {
        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status,
          contentType,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: 'server_error',
          error: `Błąd serwera źródła (HTTP ${status}).`,
          limitations: [`Serwer źródła zwrócił błąd HTTP ${status}.`],
          securityFlags,
        };
      }

      // 5. Odczyt z limitem rozmiaru dokumentu
      const readResult = await readBodyWithLimit(response, maxDocumentSize);
      if (readResult.tooLarge) {
        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status,
          contentType,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: 'document_too_large',
          error: `Dokument przekracza dopuszczalny limit rozmiaru (${maxDocumentSize} B).`,
          limitations: ['Dokument odrzucony z powodu przekroczenia limitu rozmiaru.'],
          securityFlags,
        };
      }
      if (readResult.truncated) {
        limitations.push(`Treść dokumentu została obcięta do limitu ${maxDocumentSize} bajtów.`);
      }

      // 6. Detekcja blokady WAF/antybot (bez obchodzenia!)
      const wafReason = detectWafChallenge(readResult.text, status);
      if (wafReason) {
        return {
          ok: false,
          url: targetUrl,
          finalUrl: currentUrl,
          status,
          contentType,
          body: '',
          retrievedAt,
          redirectChain,
          retrievalStatus: 'blocked_by_waf',
          error: wafReason,
          limitations: [wafReason],
          securityFlags,
        };
      }

      // 7. Detekcja prób prompt injection w pobranej treści
      const injectionFlags = detectPromptInjection(readResult.text, currentUrl);
      if (injectionFlags.length > 0) {
        securityFlags.push(...injectionFlags);
        limitations.push('W pobranej treści wykryto wzorce przypominające prompt injection – treść potraktowano wyłącznie jako niezaufane dane.');
      }

      return {
        ok: status >= 200 && status < 300,
        url: targetUrl,
        finalUrl: currentUrl,
        status,
        contentType,
        body: readResult.text,
        bytesRead: readResult.bytesRead,
        truncated: readResult.truncated,
        retrievedAt,
        redirectChain,
        retrievalStatus: status >= 200 && status < 300 ? 'ok' : `http_${status}`,
        error: status >= 200 && status < 300 ? null : `Nieoczekiwany status HTTP ${status}.`,
        limitations,
        securityFlags,
      };
    }

    return {
      ok: false,
      url: targetUrl,
      finalUrl: currentUrl,
      status: null,
      contentType: null,
      body: '',
      retrievedAt,
      redirectChain,
      retrievalStatus: 'too_many_redirects',
      error: `Przekroczono maksymalną liczbę przekierowań (${maxRedirects}).`,
      limitations: [`Przekroczono limit ${maxRedirects} przekierowań HTTP.`],
      securityFlags,
    };
  }

  return {
    fetchUrl,
    clearCache: () => requestCache.clear(),
  };
}

module.exports = {
  PROMPT_INJECTION_PATTERNS,
  WAF_PATTERNS,
  detectPromptInjection,
  containsPromptInjection,
  detectWafChallenge,
  createSourceFetcher,
};
