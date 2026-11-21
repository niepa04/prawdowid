// searchProvider.js - Dostawca wyszukiwania ściśle ograniczonego do zatwierdzonych hostów
const { extractCandidateLinks } = require('../contentExtractor');

/**
 * Tworzy dostawcę wyszukiwania:
 * 1) Wewnętrzne wyszukiwarki potwierdzone na zatwierdzonych hostach (www.gov.pl/web/gov/szukaj, kgsok.pl WP REST ?search=).
 * 2) Opcjonalny zewnętrzny provider (np. wstrzyknięty w testach lub skonfigurowany przez administratora),
 *    którego KAŻDY wynik przechodzi walidację hosta PRZED dalszym pobraniem.
 * Wyniki wyszukiwarki nigdy nie są traktowane jako samodzielny dowód.
 */
function createSearchProvider(sourceRegistry, sourceFetcher, options = {}) {
  const externalSearchImpl = options.externalSearchImpl || null;

  async function searchOnAllowedHosts(queryObj, selectedSources = []) {
    const discoveredUrls = [];
    const seen = new Set();
    const securityFlags = [];
    const errors = [];

    function acceptUrl(url, title, sourceId, discoveryMethod) {
      const check = sourceRegistry.validateUrl(url);
      if (!check.allowed) {
        securityFlags.push({
          type: 'search_result_untrusted_host_rejected',
          code: check.code,
          url,
          reason: check.reason,
        });
        return;
      }
      const normalized = check.parsed.href;
      if (seen.has(normalized)) return;
      seen.add(normalized);

      const matchedSource =
        (sourceId && sourceRegistry.getSourceById(sourceId)) ||
        sourceRegistry.findMatchingSourceForUrl(normalized);

      discoveredUrls.push({
        url: normalized,
        title: title || null,
        source_id: matchedSource ? matchedSource.source_id : null,
        discovery_method: discoveryMethod,
      });
    }

    const activeHosts = new Set(selectedSources.map((s) => s.hostname));
    if (queryObj.target_host) activeHosts.add(queryObj.target_host);

    // 1. Wewnętrzna wyszukiwarka JSON www.gov.pl (potwierdzony endpoint /api/data/search na zatwierdzonym hoście)
    if (activeHosts.has('www.gov.pl') && sourceRegistry.allowedHosts.has('www.gov.pl')) {
      const govSearchUrl = `https://www.gov.pl/api/data/search?query=${encodeURIComponent(queryObj.query)}`;
      const res = await sourceFetcher.fetchUrl(govSearchUrl, { accept: 'application/json' });
      if (res.securityFlags?.length) securityFlags.push(...res.securityFlags);
      if (res.ok) {
        try {
          const data = JSON.parse(res.body);
          const results = Array.isArray(data?.results) ? data.results : [];
          const qWords = String(queryObj.query || '')
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length >= 3);

          // Rankujemy wyniki po trafności tytułu i zajawki względem zapytania
          const ranked = results
            .filter((item) => item && typeof item.url === 'string')
            .map((item) => {
              const hay = `${item.title || ''} ${item.intro || ''}`.toLowerCase();
              const score = qWords.reduce((acc, w) => acc + (hay.includes(w.slice(0, Math.max(4, Math.floor(w.length * 0.75)))) ? 1 : 0), 0);
              return { item, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

          for (const { item } of ranked) {
            const absUrl = new URL(item.url, 'https://www.gov.pl').href;
            acceptUrl(absUrl, item.title || null, null, 'gov_pl_api_search');
          }
        } catch {
          // Fallback: jeśli mock zwrócił HTML zamiast JSON
          const links = extractCandidateLinks(res.body, res.finalUrl, sourceRegistry);
          for (const link of links.slice(0, 5)) {
            acceptUrl(link.url, link.title, null, 'gov_pl_internal_search');
          }
        }
      } else if (res.retrievalStatus !== 'not_found') {
        errors.push({
          source_id: 'www.gov.pl',
          url: govSearchUrl,
          status: res.retrievalStatus,
          message: res.error,
        });
      }
    }

    // 2. Wewnętrzne WordPress REST API search dla kgsok.pl (jeśli wybrane)
    const kgsokSelected = selectedSources.some((s) => s.hostname === 'kgsok.pl');
    if (kgsokSelected && sourceRegistry.allowedHosts.has('kgsok.pl')) {
      const wpSearchUrl = `https://kgsok.pl/wp-json/wp/v2/posts?search=${encodeURIComponent(queryObj.query)}&per_page=5`;
      const res = await sourceFetcher.fetchUrl(wpSearchUrl, { accept: 'application/json' });
      if (res.securityFlags?.length) securityFlags.push(...res.securityFlags);
      if (res.ok) {
        try {
          const posts = JSON.parse(res.body);
          if (Array.isArray(posts)) {
            for (const post of posts) {
              if (post?.link) {
                acceptUrl(post.link, post.title?.rendered || null, 'SRC029', 'wp_rest_search');
              }
            }
          }
        } catch {
          // Ignorujemy niepoprawny JSON wyszukiwania
        }
      }
    }

    // 3. Opcjonalny zewnętrzny provider (zawsze filtrowany do zatwierdzonych hostów!)
    if (typeof externalSearchImpl === 'function') {
      try {
        const rawResults = await externalSearchImpl(queryObj.site_scoped_query || queryObj.query, {
          allowedHosts: [...sourceRegistry.allowedHosts],
          query: queryObj,
        });
        for (const item of Array.isArray(rawResults) ? rawResults : []) {
          const candidateUrl = typeof item === 'string' ? item : item?.url;
          const candidateTitle = typeof item === 'object' ? item?.title : null;
          if (candidateUrl) {
            acceptUrl(candidateUrl, candidateTitle, null, 'external_site_scoped_search');
          }
        }
      } catch (err) {
        errors.push({
          source_id: 'external_search',
          url: null,
          status: 'search_provider_error',
          message: err.message,
        });
      }
    }

    return {
      discoveredUrls,
      securityFlags,
      errors,
    };
  }

  return {
    searchOnAllowedHosts,
  };
}

module.exports = {
  createSearchProvider,
};
