// evidenceCollector.js - Wielorundowe, automatyczne zbieranie dowodów dla pojedynczego twierdzenia
const { routeClaimToSources, buildClaimContextText } = require('./sourceRouter');
const { generateQueriesForClaim, extractKeywords } = require('./queryGenerator');
const { extractContent, matchCountriesFromOdyseuszDict } = require('./contentExtractor');
const { matchDocumentToClaim } = require('./evidenceMatcher');
const { deduplicateEvidence } = require('./deduplicator');
const { zbierzOcenyFactCheckerow } = require('./providers/factCheckProvider');

function scoreLinkRelevance(link, keywords) {
  const haystack = `${link.title || ''} ${link.url || ''}`.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    const stem = k.length > 4 ? k.slice(0, Math.max(4, Math.floor(k.length * 0.72))) : k;
    if (haystack.includes(stem)) hits++;
  }
  return hits;
}

/**
 * Zbiera materiały z jednego konkretnego źródła (API / RSS / HTML + pasujące podstrony).
 */
async function collectFromSource(source, claimKeywords, sourceRegistry, sourceFetcher, config, claimContextText = '') {
  const docs = [];
  const errors = [];
  const securityFlags = [];
  const visitedUrls = new Set();
  let sourceAccessible = false;

  const entryUrls = [];
  if (source.discovered_api_url && sourceRegistry.isUrlAllowed(source.discovered_api_url)) {
    entryUrls.push({ url: source.discovered_api_url, accept: 'application/json' });
  } else if (source.discovered_feed_url && sourceRegistry.isUrlAllowed(source.discovered_feed_url)) {
    entryUrls.push({ url: source.discovered_feed_url, accept: 'application/rss+xml,application/xml,text/xml' });
  } else {
    entryUrls.push({ url: source.url, accept: 'text/html,application/xhtml+xml' });
  }

  for (const sub of source.subpages || []) {
    if (sourceRegistry.isUrlAllowed(sub)) {
      entryUrls.push({ url: sub, accept: 'text/html,application/xhtml+xml' });
    }
  }

  const candidateSublinks = [];

  for (const entry of entryUrls) {
    if (visitedUrls.has(entry.url)) continue;
    visitedUrls.add(entry.url);

    const res = await sourceFetcher.fetchUrl(entry.url, { accept: entry.accept });
    if (res.securityFlags?.length) securityFlags.push(...res.securityFlags);

    if (!res.ok) {
      errors.push({
        source_id: source.source_id,
        url: entry.url,
        status: res.retrievalStatus,
        message: res.error,
      });
      continue;
    }

    const extracted = extractContent(res, source, sourceRegistry);
    if (extracted.parseError) {
      errors.push({
        source_id: source.source_id,
        url: entry.url,
        status: 'api_parse_error',
        message: extracted.parseError,
      });
      continue;
    }

    const allSpaEmpty =
      extracted.documents.length > 0 &&
      extracted.documents.every((d) => d.retrieval_status === 'requires_js_rendering');

    if (allSpaEmpty) {
      errors.push({
        source_id: source.source_id,
        url: entry.url,
        status: 'requires_js_rendering',
        message: 'Strona wymaga renderowania JS (SPA) i nie udostępnia potwierdzonego publicznego API na zatwierdzonym hoście.',
      });
      continue;
    }

    sourceAccessible = true;
    docs.push(...extracted.documents);

    // Jeśli źródło zwróciło słownik państw Odyseusza (/api/v1/informacje/profile-panstw/mini),
    // dopasowujemy państwa z twierdzenia i pobieramy ich oficjalne ostrzeżenia oraz profil kraju z odyseusz.gov.pl
    if (Array.isArray(extracted.odyseuszCountries) && extracted.odyseuszCountries.length > 0) {
      const matchedCountries = matchCountriesFromOdyseuszDict(
        extracted.odyseuszCountries,
        claimContextText || claimKeywords.join(' ')
      ).slice(0, 3);

      const odyseuszFollowups = [];
      for (const c of matchedCountries) {
        odyseuszFollowups.push({
          url: `https://odyseusz.gov.pl/api/v1/informacje/${encodeURIComponent(c.kodIso)}/ostrzezenia`,
          countryName: c.nazwa,
          kodIso: c.kodIso,
        });
        odyseuszFollowups.push({
          url: `https://odyseusz.gov.pl/api/v1/informacje/profile-panstw/${encodeURIComponent(c.kodIso)}`,
          countryName: c.nazwa,
          kodIso: c.kodIso,
        });
      }
      if (odyseuszFollowups.length === 0) {
        odyseuszFollowups.push({
          url: 'https://odyseusz.gov.pl/api/v1/informacje/strona-glowna/mini',
          countryName: null,
          kodIso: null,
        });
      }

      for (const item of odyseuszFollowups) {
        if (visitedUrls.has(item.url) || !sourceRegistry.isUrlAllowed(item.url)) continue;
        visitedUrls.add(item.url);
        const fRes = await sourceFetcher.fetchUrl(item.url, { accept: 'application/json' });
        if (fRes.securityFlags?.length) securityFlags.push(...fRes.securityFlags);
        if (fRes.ok) {
          const fExt = extractContent(fRes, source, sourceRegistry);
          for (const d of fExt.documents) {
            if (item.countryName && !d.text.toLowerCase().includes(item.countryName.toLowerCase())) {
              d.title = `MSZ Odyseusz – Ostrzeżenia dla podróżujących: ${item.countryName} (${item.kodIso})`;
              d.text = `Państwo: ${item.countryName} (${item.kodIso}). ${d.text}`;
            }
            docs.push(d);
          }
        }
      }
    }

    for (const link of extracted.links || []) {
      if (!visitedUrls.has(link.url) && sourceRegistry.isUrlAllowed(link.url)) {
        candidateSublinks.push(link);
      }
    }
  }

  // Dociąganie podstron warstwami (wyłącznie z dozwolonych hostów).
  // Poziom 1 = linki ze stron wejściowych, poziom 2 = linki z pobranych podstron itd.
  // Na każdym poziomie bierzemy najlepiej pasujące do twierdzenia linki (maxSubpagesPerSource),
  // a łączna liczba podstron ze źródła jest ograniczona przez maxPagesPerSource.
  const maxDepth = Math.max(1, config.maxCrawlDepth || 1);
  const maxPages = Math.max(1, config.maxPagesPerSource || config.maxSubpagesPerSource || 4);
  let pagesFetched = 0;
  let level = candidateSublinks;

  for (let depth = 1; depth <= maxDepth && level.length > 0 && pagesFetched < maxPages; depth++) {
    const seenInLevel = new Set();
    const ranked = level
      .filter((link) => !visitedUrls.has(link.url) && !seenInLevel.has(link.url) && seenInLevel.add(link.url))
      .map((link) => ({ link, hits: scoreLinkRelevance(link, claimKeywords) }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, Math.min(config.maxSubpagesPerSource || 4, maxPages - pagesFetched));

    const nextLevel = [];
    for (const { link } of ranked) {
      if (visitedUrls.has(link.url)) continue;
      visitedUrls.add(link.url);
      pagesFetched++;

      const subRes = await sourceFetcher.fetchUrl(link.url);
      if (subRes.securityFlags?.length) securityFlags.push(...subRes.securityFlags);

      if (!subRes.ok) {
        errors.push({
          source_id: source.source_id,
          url: link.url,
          status: subRes.retrievalStatus,
          message: subRes.error,
        });
        continue;
      }

      const subExtracted = extractContent(subRes, source, sourceRegistry);
      for (const d of subExtracted.documents) d.crawl_depth = depth;
      docs.push(...subExtracted.documents);

      if (depth < maxDepth) {
        for (const l of subExtracted.links || []) {
          if (!visitedUrls.has(l.url) && sourceRegistry.isUrlAllowed(l.url)) nextLevel.push(l);
        }
      }
    }
    level = nextLevel;
  }

  return {
    sourceId: source.source_id,
    sourceAccessible,
    docs,
    errors,
    securityFlags,
  };
}

/**
 * Oceny niezależnych fact-checkerów (Google Fact Check Tools API) + przeglądanie Demagoga.
 * Demagog blokuje boty na stronie głównej, w RSS i wyszukiwarce, ale artykuły otwierają się normalnie.
 * Dlatego adresy pasujących artykułów bierzemy z bazy Google, otwieramy je i schodzimy po linkach
 * do powiązanych artykułów Demagoga (ten sam mechanizm i limity co dla źródeł rządowych, tylko mniejsze).
 */
async function zbierzZFactCheckerow(claim, allClaims, deps, claimKeywords, claimContextText) {
  const { sourceRegistry, sourceFetcher, config, nowMs } = deps;
  const wynik = { evidence: [], warnings: [], errors: [], securityFlags: [], sourcesChecked: [] };
  if (!config.factCheckApiKey) return wynik;

  const fc = await zbierzOcenyFactCheckerow(claim, allClaims, config, nowMs || Date.now());
  wynik.evidence.push(...fc.evidence);
  wynik.warnings.push(...fc.warnings);

  const demagog = sourceRegistry.getSourceById('SRC041');
  const artykuly = (fc.artykuly || [])
    .filter((url) => sourceRegistry.isUrlAllowed(url))
    .slice(0, config.maxDemagogArticles || 2);
  if (!demagog || artykuly.length === 0) return wynik;

  // Artykuły jako strony wejściowe "źródła" Demagog; collectFromSource otworzy je i pójdzie po linkach
  const zrodlo = { ...demagog, url: artykuly[0], subpages: artykuly.slice(1), discovered_feed_url: null, discovered_api_url: null };
  const configDemagoga = { ...config, maxSubpagesPerSource: 2, maxPagesPerSource: 3 };
  const col = await collectFromSource(zrodlo, claimKeywords, sourceRegistry, sourceFetcher, configDemagoga, claimContextText);

  wynik.sourcesChecked.push(demagog.source_id);
  wynik.errors.push(...col.errors);
  wynik.securityFlags.push(...col.securityFlags);
  // Artykuł fact-checkera, który ocenił twierdzenie, ma relację z jego oceny (matcher widzi tylko
  // te same słowa i artykuł obalający twierdzenie brałby za potwierdzenie). Pozostałe artykuły,
  // znalezione po linkach, traktujemy jako kontekst.
  const relacjaOceny = new Map(fc.evidence.map((e) => [e.url, e]));
  for (const doc of col.docs) {
    const matched = matchDocumentToClaim(doc, claim, allClaims, config, { nowMs });
    if (!matched) continue;
    const ocena = relacjaOceny.get(matched.url);
    matched.relation_to_claim = ocena ? ocena.relation_to_claim : 'contextual';
    matched.discrepancies = ocena ? [...(ocena.discrepancies || [])] : [];
    matched.source_type = 'fact_checking';
    wynik.evidence.push(matched);
  }
  return wynik;
}

/**
 * Wykonuje pełny, wielorundowy proces zbierania dowodów dla pojedynczego twierdzenia z Modelu 2.
 */
async function collectEvidenceForClaim(claim, allClaims, deps) {
  const { sourceRegistry, sourceFetcher, searchProvider, config, nowMs } = deps;
  const maxRounds = Math.max(1, config.maxRounds || 3);
  const claimId = claim.id;
  const claimText = claim.claim;

  const warnings = [];
  const errors = [];
  const securityFlags = [];
  const sourcesChecked = new Set();
  const sourcesUnavailable = new Set();
  const allQueries = [];
  const rawEvidence = [];
  const fetchedUrls = new Set();

  // 1. Routing tematyczny
  let routing = routeClaimToSources(claim, allClaims, sourceRegistry, {
    maxSourcesPerClaim: config.maxSourcesPerClaim,
  });

  // Żadne źródło nie pasuje tematycznie, a twierdzenie jest faktem do sprawdzenia:
  // przeszukujemy ogólne kanały (KPRM, RCB, MON, system ostrzeżeń). Dzięki temu brak wyników
  // coś znaczy - o poważnym zdarzeniu w Polsce te kanały by informowały.
  const weryfikowalne = claim.type !== 'opinion' && claim.type !== 'non_verifiable';
  if ((routing.noSuitableSource || routing.selectedSources.length === 0) && weryfikowalne) {
    const zapasowe = (config.fallbackSourceIds || [])
      .map((id) => sourceRegistry.getSourceById(id))
      .filter((s) => s && s.enabled);
    if (zapasowe.length > 0) {
      routing = { ...routing, selectedSources: zapasowe, noSuitableSource: false, routingNote: null };
      warnings.push('Brak źródeł dopasowanych do tematu – przeszukano ogólne kanały informacyjne (KPRM, RCB, MON, system ostrzeżeń).');
    }
  }

  if (routing.noSuitableSource || routing.selectedSources.length === 0) {
    if (routing.routingNote) warnings.push(routing.routingNote);

    // Brak pasującego źródła rządowego, ale fakt mógł już ocenić niezależny fact-checker
    let fcEvidence = [];
    // Także dla "opinii": Model 2 czasem tak oznacza fałszywe twierdzenia (np. o szczepionkach),
    // a fact-checkerzy mogli je już sprawdzić. Werdykt i tak zależy od tego, czy ocena się znajdzie.
    if (config.factCheckApiKey) {
      const fc = await zbierzZFactCheckerow(claim, allClaims, deps, extractKeywords(claimText, 8), buildClaimContextText(claim, allClaims));
      fcEvidence = deduplicateEvidence(fc.evidence).evidence;
      warnings.push(...fc.warnings);
      errors.push(...fc.errors);
      securityFlags.push(...fc.securityFlags);
      fc.sourcesChecked.forEach((s) => sourcesChecked.add(s));
    }

    return {
      claimResult: {
        claim_id: claimId,
        claim: claimText,
        claim_type: claim.type || null,
        related_to: Array.isArray(claim.related_to) ? claim.related_to : [],
        matched_categories: routing.matchedCategories || [],
        category_labels: routing.matchedCategoryLabels || [],
        search_status: fcEvidence.length > 0 ? 'completed' : 'no_suitable_source',
        selected_sources: [],
        queries: [],
        evidence: fcEvidence,
        coverage: {
          supporting: fcEvidence.filter((e) => e.relation_to_claim === 'supporting').length,
          contradicting: fcEvidence.filter((e) => e.relation_to_claim === 'contradicting').length,
          contextual: fcEvidence.filter((e) => e.relation_to_claim === 'contextual').length,
        },
        warnings,
        errors,
      },
      sourcesChecked: [...sourcesChecked],
      sourcesUnavailable: [],
      securityFlags,
    };
  }

  const selectedSources = routing.selectedSources;
  const claimContextText = buildClaimContextText(claim, allClaims);
  const claimKeywords = extractKeywords(claimText, 8);
  let accessibleSourcesCount = 0;

  // 2. Automatyczne rundy wyszukiwania (1..maxRounds)
  for (let round = 1; round <= maxRounds; round++) {
    const roundQueries = generateQueriesForClaim(claim, allClaims, selectedSources, {
      maxQueries: config.maxQueries,
      round,
    });
    allQueries.push(...roundQueries);

    if (round === 1) {
      // Runda 1: bezpośrednie pobranie z wyselekcjonowanych źródeł (API, RSS, HTML, pomiary, Odyseusz)
      for (const source of selectedSources) {
        sourcesChecked.add(source.source_id);
        const col = await collectFromSource(source, claimKeywords, sourceRegistry, sourceFetcher, config, claimContextText);
        if (col.securityFlags.length) securityFlags.push(...col.securityFlags);
        if (col.errors.length) errors.push(...col.errors);

        if (!col.sourceAccessible) {
          sourcesUnavailable.add(source.source_id);
        } else {
          accessibleSourcesCount++;
        }

        for (const doc of col.docs) {
          fetchedUrls.add(doc.url);
          const matched = matchDocumentToClaim(doc, claim, allClaims, config, { nowMs });
          if (matched) rawEvidence.push(matched);
        }
      }
    } else {
      // Runda 2 i 3: aktywne wyszukiwanie na zatwierdzonych hostach (w tym sprawdzanie zaprzeczeń/odwołań)
      if (!searchProvider) break;

      const discoveredBatch = [];
      for (const q of roundQueries) {
        const searchRes = await searchProvider.searchOnAllowedHosts(q, selectedSources);
        if (searchRes.securityFlags.length) securityFlags.push(...searchRes.securityFlags);
        if (searchRes.errors.length) errors.push(...searchRes.errors);
        discoveredBatch.push(...searchRes.discoveredUrls);
      }

      let fetchedInRound = 0;
      for (const item of discoveredBatch) {
        if (fetchedUrls.has(item.url)) continue;
        if (!sourceRegistry.isUrlAllowed(item.url)) continue;
        fetchedUrls.add(item.url);

        const matchedSource =
          (item.source_id && sourceRegistry.getSourceById(item.source_id)) ||
          sourceRegistry.findMatchingSourceForUrl(item.url);
        if (!matchedSource) continue;

        sourcesChecked.add(matchedSource.source_id);
        const res = await sourceFetcher.fetchUrl(item.url);
        if (res.securityFlags?.length) securityFlags.push(...res.securityFlags);

        if (!res.ok) {
          errors.push({
            source_id: matchedSource.source_id,
            url: item.url,
            status: res.retrievalStatus,
            message: res.error,
          });
          continue;
        }

        fetchedInRound++;
        const extracted = extractContent(res, matchedSource, sourceRegistry);
        for (const doc of extracted.documents) {
          const matched = matchDocumentToClaim(doc, claim, allClaims, config, { nowMs });
          if (matched) rawEvidence.push(matched);
        }
      }

      // Jeśli runda 2 nie przyniosła nowych stron do sprawdzenia, przerywamy pętlę rund
      if (fetchedInRound === 0 && round >= 2) {
        break;
      }
    }

    // Sprawdzenie po rundzie 1: jeśli mamy już zarówno dowody potwierdzające jak i sprawdzone sprzeczności
    // albo gdy żadne źródło nie ma dostępnego wyszukiwania na kolejną rundę
    const hasDirectSupporting = rawEvidence.some((e) => e.relation_to_claim === 'supporting' && e.relevance === 'direct');
    const hasContradicting = rawEvidence.some((e) => e.relation_to_claim === 'contradicting');
    if (round === 1 && hasDirectSupporting && hasContradicting) {
      break;
    }
    if (round === 2 && (hasDirectSupporting || hasContradicting)) {
      break;
    }
  }

  // Oceny niezależnych fact-checkerów i artykuły Demagoga (najwyżej 2 zapytania do API na twierdzenie)
  if (config.factCheckApiKey) {
    const fc = await zbierzZFactCheckerow(claim, allClaims, deps, claimKeywords, claimContextText);
    rawEvidence.push(...fc.evidence);
    warnings.push(...fc.warnings);
    errors.push(...fc.errors);
    securityFlags.push(...fc.securityFlags);
    fc.sourcesChecked.forEach((s) => sourcesChecked.add(s));
  }

  // 3. Deduplikacja i wyznaczenie independence_group
  const { evidence } = deduplicateEvidence(rawEvidence);

  // Sortowanie: najpierw direct, potem partial, potem contextual
  const relevanceRank = { direct: 0, partial: 1, contextual: 2 };
  evidence.sort((a, b) => (relevanceRank[a.relevance] ?? 3) - (relevanceRank[b.relevance] ?? 3));

  const coverage = {
    supporting: evidence.filter((e) => e.relation_to_claim === 'supporting').length,
    contradicting: evidence.filter((e) => e.relation_to_claim === 'contradicting').length,
    contextual: evidence.filter((e) => e.relation_to_claim === 'contextual').length,
  };

  if (coverage.supporting > 0 && coverage.contradicting > 0) {
    warnings.push('W zatwierdzonych źródłach odnaleziono materiały potencjalnie sprzeczne – wymagana szczegółowa analiza w module weryfikacji.');
  }

  if (evidence.some((e) => (e.limitations || []).some((l) => /nieaktualn|wygasł/i.test(l)))) {
    warnings.push('Co najmniej jeden odnaleziony materiał może być nieaktualny względem bieżącej sytuacji.');
  }

  if (sourcesUnavailable.size > 0) {
    warnings.push(
      `Część wybranych źródeł była niedostępna (${[...sourcesUnavailable].join(', ')}) – brak wyników nie oznacza braku zdarzenia lub zagrożenia.`
    );
  }

  let searchStatus;
  if (accessibleSourcesCount === 0 && evidence.length === 0) {
    searchStatus = 'sources_unavailable';
    warnings.push('Żadne z wybranych źródeł nie było technicznie dostępne (awaria / WAF / TLS / SPA). To jest status techniczny, nie werdykt.');
  } else if (evidence.length === 0) {
    searchStatus = 'no_results';
    warnings.push('Brak pasujących materiałów w sprawdzonych zatwierdzonych źródłach. Brak informacji nie oznacza, że twierdzenie jest fałszywe.');
  } else if (sourcesUnavailable.size > 0) {
    searchStatus = 'partial';
  } else {
    searchStatus = 'completed';
  }

  return {
    claimResult: {
      claim_id: claimId,
      claim: claimText,
      claim_type: claim.type || null,
      related_to: Array.isArray(claim.related_to) ? claim.related_to : [],
      matched_categories: routing.matchedCategories || [],
      category_labels: routing.matchedCategoryLabels || [],
      search_status: searchStatus,
      selected_sources: selectedSources.map((s) => s.source_id),
      queries: allQueries.map((q) => q.site_scoped_query),
      evidence,
      coverage,
      warnings,
      errors,
    },
    sourcesChecked: [...sourcesChecked],
    sourcesUnavailable: [...sourcesUnavailable],
    securityFlags,
  };
}

module.exports = {
  collectFromSource,
  collectEvidenceForClaim,
};
