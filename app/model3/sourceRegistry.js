// sourceRegistry.js - Rejestr zatwierdzonych źródeł, lista dozwolonych hostów i ochrona SSRF
const fs = require('node:fs');
const net = require('node:net');
const { getConfig } = require('./config');

class SourceRegistryError extends Error {
  constructor(message, code = 'SOURCE_REGISTRY_ERROR', cause = null) {
    super(message);
    this.name = 'SourceRegistryError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * Sprawdza, czy podany adres IP (IPv4 lub IPv6) jest prywatny, lokalny lub zarezerwowany (SSRF).
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIp(ip) {
  if (typeof ip !== 'string') return true;
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // IPv4-mapped IPv6, np. ::ffff:127.0.0.1 lub ::ffff:7f00:1
  if (clean.startsWith('::ffff:')) {
    const tail = clean.slice('::ffff:'.length);
    if (net.isIPv4(tail)) {
      return isPrivateIp(tail);
    }
    const hexParts = tail.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
        return isPrivateIp(ipv4);
      }
    }
    return true;
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local / metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT / Tailscale)
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(clean)) {
    if (clean === '::1' || clean === '::') return true;
    if (/^(fc|fd)/i.test(clean)) return true; // ULA fc00::/7
    if (/^fe[89ab]/i.test(clean)) return true; // link-local fe80::/10
    if (/^ff/i.test(clean)) return true; // multicast
    return false;
  }

  return false;
}

/**
 * Sprawdza, czy hostname wskazuje na localhost, sieć prywatną lub surowy adres IP.
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateOrLocalHost(hostname) {
  if (typeof hostname !== 'string' || hostname.trim().length === 0) return true;
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'ip6-localhost' ||
    host === 'ip6-loopback'
  ) {
    return true;
  }

  // Dekodowanie nietypowych zapisów IPv4 (np. dziesiętny 2130706433 lub ósemkowy 0177.0.0.1)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true;
  }

  if (net.isIP(host)) {
    return isPrivateIp(host);
  }

  return false;
}

function normalizeUrlForLookup(urlStr) {
  const parsed = new URL(urlStr);
  return parsed.href;
}

function loadOptionalSourceMap(sourceMapPath) {
  if (!sourceMapPath || !fs.existsSync(sourceMapPath)) {
    return new Map();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    const byUrl = new Map();
    if (raw && Array.isArray(raw.sources)) {
      for (const entry of raw.sources) {
        if (entry && typeof entry.source_url === 'string') {
          byUrl.set(entry.source_url, entry);
        }
      }
    }
    return byUrl;
  } catch {
    return new Map();
  }
}

/**
 * Tworzy i waliduje rejestr zaufanych źródeł na podstawie katalogu JSON.
 * @param {object} [options]
 * @param {string} [options.registryPath]
 * @param {string} [options.sourceMapPath]
 * @param {object} [options.catalogData] - Bezpośrednie dane JSON (przydatne w testach)
 * @param {object} [options.sourceMapData] - Bezpośrednia mapa źródeł (przydatne w testach)
 */
function createSourceRegistry(options = {}) {
  const config = getConfig();
  const registryPath = options.registryPath || config.sourceRegistryPath;
  const sourceMapPath = options.sourceMapPath !== undefined ? options.sourceMapPath : config.sourceMapPath;

  let rawCatalog;
  if (options.catalogData !== undefined) {
    rawCatalog = options.catalogData;
  } else {
    if (!fs.existsSync(registryPath)) {
      throw new SourceRegistryError(
        `Brak pliku katalogu oficjalnych źródeł: ${registryPath}`,
        'REGISTRY_FILE_MISSING'
      );
    }
    let content;
    try {
      content = fs.readFileSync(registryPath, 'utf8');
    } catch (err) {
      throw new SourceRegistryError(
        `Nie można odczytać pliku katalogu źródeł: ${err.message}`,
        'REGISTRY_READ_ERROR',
        err
      );
    }
    try {
      rawCatalog = JSON.parse(content);
    } catch (err) {
      throw new SourceRegistryError(
        `Plik katalogu źródeł nie zawiera poprawnego JSON-a: ${err.message}`,
        'REGISTRY_INVALID_JSON',
        err
      );
    }
  }

  if (!rawCatalog || typeof rawCatalog !== 'object' || Array.isArray(rawCatalog)) {
    throw new SourceRegistryError(
      'Katalog źródeł musi być obiektem JSON.',
      'REGISTRY_INVALID_SCHEMA'
    );
  }

  if (!Array.isArray(rawCatalog.sources) || rawCatalog.sources.length === 0) {
    throw new SourceRegistryError(
      'Katalog źródeł musi zawierać niepustą tablicę "sources".',
      'REGISTRY_INVALID_SCHEMA'
    );
  }

  let mapByUrl;
  if (options.sourceMapData && Array.isArray(options.sourceMapData.sources)) {
    mapByUrl = new Map(options.sourceMapData.sources.map((e) => [e.source_url, e]));
  } else {
    mapByUrl = loadOptionalSourceMap(sourceMapPath);
  }

  const allSources = [];
  const enabledSources = [];
  const disabledSources = [];
  const allowedHosts = new Set();
  const byId = new Map();

  rawCatalog.sources.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SourceRegistryError(
        `Wpis źródła nr ${index + 1} musi być obiektem.`,
        'REGISTRY_INVALID_SCHEMA'
      );
    }

    const rawUrl = entry.url || entry.source_url;
    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      throw new SourceRegistryError(
        `Wpis źródła nr ${index + 1} nie ma poprawnego pola "url".`,
        'REGISTRY_INVALID_SCHEMA'
      );
    }

    if (typeof entry.enabled !== 'boolean') {
      throw new SourceRegistryError(
        `Wpis źródła nr ${index + 1} (${rawUrl}) musi mieć logiczne pole "enabled".`,
        'REGISTRY_INVALID_SCHEMA'
      );
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl.trim());
    } catch (err) {
      throw new SourceRegistryError(
        `Wpis źródła nr ${index + 1} zawiera nieprawidłowy adres URL: ${rawUrl}`,
        'REGISTRY_INVALID_SCHEMA',
        err
      );
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new SourceRegistryError(
        `Wpis źródła nr ${index + 1} używa niedozwolonego protokołu: ${parsedUrl.protocol}`,
        'REGISTRY_INVALID_SCHEMA'
      );
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (isPrivateOrLocalHost(hostname)) {
      throw new SourceRegistryError(
        `Wpis źródła nr ${index + 1} wskazuje na prywatny lub lokalny host: ${hostname}`,
        'REGISTRY_SSRF_HOST'
      );
    }

    const meta = mapByUrl.get(rawUrl.trim()) || mapByUrl.get(normalizeUrlForLookup(rawUrl.trim())) || {};
    const sourceId =
      (typeof entry.source_id === 'string' && entry.source_id.trim()) ||
      (typeof entry.id === 'string' && entry.id.trim()) ||
      meta.source_id ||
      `SRC${String(index + 1).padStart(3, '0')}`;

    if (byId.has(sourceId)) {
      throw new SourceRegistryError(
        `Zduplikowany identyfikator źródła: ${sourceId}`,
        'REGISTRY_DUPLICATE_ID'
      );
    }

    const sourceRecord = {
      source_id: sourceId,
      name: entry.name || meta.name || hostname,
      url: rawUrl.trim(),
      source_url: rawUrl.trim(),
      hostname,
      enabled: entry.enabled,
      category: entry.category || meta.category || 'uncategorized',
      secondary_categories: Array.isArray(entry.secondary_categories)
        ? entry.secondary_categories
        : Array.isArray(meta.secondary_categories)
          ? meta.secondary_categories
          : [],
      topics: Array.isArray(entry.topics)
        ? entry.topics
        : Array.isArray(meta.topics)
          ? meta.topics
          : [],
      source_type: entry.source_type || meta.source_type || 'official_government',
      priority: Number.isFinite(Number(entry.priority))
        ? Number(entry.priority)
        : Number.isFinite(Number(meta.priority))
          ? Number(meta.priority)
          : 3,
      source_role: entry.source_role || meta.source_role || 'news_alerts',
      data_type: meta.data_type || 'html',
      access_method: meta.access_method || 'html_list',
      supports_current_information:
        typeof meta.supports_current_information === 'boolean'
          ? meta.supports_current_information
          : true,
      discovered_feed_url: meta.discovered_feed_url || null,
      discovered_api_url: meta.discovered_api_url || null,
      api_adapter: meta.api_adapter || null,
      subpages: Array.isArray(meta.subpages) ? meta.subpages : [],
      last_checked: meta.last_checked || null,
      accessibility_status: meta.accessibility_status || 'unknown',
      limitations: Array.isArray(meta.limitations) ? [...meta.limitations] : [],
    };

    allSources.push(sourceRecord);
    byId.set(sourceId, sourceRecord);

    if (sourceRecord.enabled) {
      enabledSources.push(sourceRecord);
      allowedHosts.add(hostname);
    } else {
      disabledSources.push(sourceRecord);
    }
  });

  /**
   * Sprawdza bezpieczeństwo i dopuszczalność URL-a przed pobraniem.
   * Dokładne dopasowanie hosta – bez automatycznego dopuszczania subdomen.
   */
  function validateUrl(urlString) {
    if (typeof urlString !== 'string' || urlString.trim().length === 0) {
      return { allowed: false, code: 'INVALID_URL', reason: 'Adres URL jest pusty.' };
    }

    let parsed;
    try {
      parsed = new URL(urlString.trim());
    } catch {
      return { allowed: false, code: 'INVALID_URL', reason: `Niepoprawny adres URL: ${urlString}` };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        allowed: false,
        code: 'DISALLOWED_PROTOCOL',
        reason: `Niedozwolony protokół URL: ${parsed.protocol}`,
      };
    }

    if (parsed.username || parsed.password) {
      return {
        allowed: false,
        code: 'CREDENTIALS_IN_URL',
        reason: 'Adres URL nie może zawierać danych uwierzytelniających.',
      };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (isPrivateOrLocalHost(hostname)) {
      return {
        allowed: false,
        code: 'SSRF_BLOCKED',
        reason: `Zablokowano próbę dostępu do lokalnego lub prywatnego hosta: ${hostname}`,
      };
    }

    if (!allowedHosts.has(hostname)) {
      return {
        allowed: false,
        code: 'HOST_NOT_ALLOWED',
        reason: `Host "${hostname}" nie znajduje się na liście zatwierdzonych źródeł z katalogu.`,
      };
    }

    return { allowed: true, parsed, hostname };
  }

  function isUrlAllowed(urlString) {
    return validateUrl(urlString).allowed;
  }

  function assertUrlAllowed(urlString) {
    const check = validateUrl(urlString);
    if (!check.allowed) {
      throw new SourceRegistryError(check.reason, check.code);
    }
    return check;
  }

  function getSourceById(sourceId) {
    return byId.get(sourceId) || null;
  }

  function findMatchingSourceForUrl(urlString) {
    const check = validateUrl(urlString);
    if (!check.allowed) return null;
    const href = check.parsed.href;
    // Najpierw dopasowanie po prefiksie ścieżki (najbardziej szczegółowe źródło)
    const candidates = enabledSources
      .filter((s) => s.hostname === check.hostname)
      .sort((a, b) => b.url.length - a.url.length);

    for (const s of candidates) {
      const base = s.url.split('#')[0].replace(/\/+$/, '');
      if (href.startsWith(base)) return s;
    }
    return candidates[0] || null;
  }

  return {
    schemaVersion: rawCatalog.schema_version || 1,
    description: rawCatalog.description || '',
    allSources,
    enabledSources,
    disabledSources,
    allowedHosts,
    validateUrl,
    isUrlAllowed,
    assertUrlAllowed,
    getSourceById,
    findMatchingSourceForUrl,
  };
}

module.exports = {
  SourceRegistryError,
  isPrivateIp,
  isPrivateOrLocalHost,
  createSourceRegistry,
};
