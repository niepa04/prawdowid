// sourceDiscovery.js - Audyt rzeczywistej struktury i dostępności źródeł z katalogu
const { createSourceRegistry } = require('./sourceRegistry');
const { createSourceFetcher } = require('./sourceFetcher');
const { getConfig } = require('./config');

/**
 * Analizuje pojedyncze źródło na podstawie jego rzeczywistej odpowiedzi HTTP (bez zgadywania).
 */
async function inspectSingleSource(source, sourceRegistry, sourceFetcher) {
  const checkedAt = new Date().toISOString();
  const res = await sourceFetcher.fetchUrl(source.url, { useCache: false });

  if (!res.ok) {
    return {
      source_id: source.source_id,
      source_url: source.source_url,
      hostname: source.hostname,
      category: source.category,
      source_role: source.source_role,
      data_type: res.retrievalStatus === 'blocked_by_waf' ? 'blocked' : 'unavailable',
      access_method: res.retrievalStatus,
      supports_current_information: source.supports_current_information,
      discovered_feed_url: source.discovered_feed_url,
      discovered_api_url: source.discovered_api_url,
      last_checked: checkedAt,
      accessibility_status: res.retrievalStatus,
      limitations: res.limitations || [res.error || 'Źródło niedostępne.'],
    };
  }

  const html = res.body || '';
  const feeds = [];
  for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*alternate[^"']*["'][^>]*>/gi)) {
    const tag = m[0];
    if (/rss|atom|xml/i.test(tag)) {
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
      if (href) {
        try {
          const abs = new URL(href, res.finalUrl).href;
          if (sourceRegistry.isUrlAllowed(abs) && !/oembed/i.test(abs)) {
            feeds.push(abs);
          }
        } catch {
          // Ignorujemy niepoprawne linki
        }
      }
    }
  }

  const cleanTextLen = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;

  const isSpa =
    cleanTextLen < 150 &&
    (/<app-root\b/i.test(html) || /<div[^>]+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i.test(html) || /data-beasties-container/i.test(html));

  const limitations = [...(res.limitations || [])];
  if (isSpa) {
    limitations.push('Strona jest aplikacją SPA wymagającą renderowania JS.');
  }

  const confirmedFeed = source.discovered_feed_url || feeds[0] || null;
  const confirmedApi = source.discovered_api_url || null;

  let accessMethod = 'html_list';
  let dataType = 'html';
  let accessibilityStatus = 'accessible';

  if (confirmedApi) {
    accessMethod = source.source_role === 'live_measurements' ? 'live_measurements_api' : 'json_api';
    dataType = 'json_api';
  } else if (confirmedFeed) {
    accessMethod = 'rss_feed';
    dataType = 'rss_and_html';
  } else if (isSpa) {
    accessMethod = 'spa_requires_js';
    dataType = 'spa_html';
    accessibilityStatus = 'requires_js_rendering';
  }

  return {
    source_id: source.source_id,
    source_url: source.source_url,
    hostname: source.hostname,
    category: source.category,
    source_role: source.source_role,
    data_type: dataType,
    access_method: accessMethod,
    supports_current_information: source.supports_current_information,
    discovered_feed_url: confirmedFeed,
    discovered_api_url: confirmedApi,
    last_checked: checkedAt,
    accessibility_status: accessibilityStatus,
    has_open_graph: /property=["']og:/i.test(html),
    has_json_ld: /type=["']application\/ld\+json["']/i.test(html),
    has_pagination: /pagin|strona=\d|page=\d|następna|kolejna/i.test(html),
    limitations,
  };
}

/**
 * Przeprowadza audyt wszystkich aktywnych źródeł z katalogu z limitem współbieżności.
 */
async function discoverAllSources(options = {}) {
  const config = getConfig(options.config);
  const registry = options.sourceRegistry || createSourceRegistry(options);
  const fetcher = options.sourceFetcher || createSourceFetcher(registry, config, options);
  const concurrency = Math.max(1, options.concurrency || config.maxConcurrency || 4);

  const queue = [...registry.enabledSources];
  const results = [];

  async function worker() {
    while (queue.length > 0) {
      const source = queue.shift();
      const report = await inspectSingleSource(source, registry, fetcher);
      results.push(report);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  results.sort((a, b) => a.source_id.localeCompare(b.source_id));

  return {
    checked_at: new Date().toISOString(),
    total_sources: registry.allSources.length,
    enabled_sources: registry.enabledSources.length,
    sources: results,
  };
}

module.exports = {
  inspectSingleSource,
  discoverAllSources,
};
