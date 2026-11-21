// contentExtractor.js - Wspólne adaptery parsowania: HTML, RSS/Atom, JSON/API, Dane pomiarowe

const POLISH_MONTHS = {
  stycznia: 1,
  lutego: 2,
  marca: 3,
  kwietnia: 4,
  maja: 5,
  czerwca: 6,
  lipca: 7,
  sierpnia: 8,
  września: 9,
  października: 10,
  listopada: 11,
  grudnia: 12,
};

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  copy: '©',
};

function decodeEntities(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function stripHtmlToText(html) {
  if (typeof html !== 'string') return '';
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|p|div|li|tr|h[1-6]|section|article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function normalizeDateToIso(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  // ISO 8601 lub YYYY-MM-DD HH:mm:ss
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?/);
  if (isoMatch) {
    const [, y, m, d, hh = '00', mm = '00', ss = '00', tz] = isoMatch;
    const candidate = `${y}-${m}-${d}T${hh}:${mm}:${ss}${tz || 'Z'}`;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() >= 1990 && parsed.getUTCFullYear() <= 2100) {
      return parsed.toISOString();
    }
  }

  // Polski format DD.MM.YYYY [HH:mm]
  const plNum = s.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?\b/);
  if (plNum) {
    const [, dd, mm, yyyy, hh = '00', min = '00'] = plNum;
    const candidate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${min}:00Z`;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() >= 1990 && parsed.getUTCFullYear() <= 2100) {
      return parsed.toISOString();
    }
  }

  // Polski format słowny np. "21 listopada 2026"
  const plWord = s.toLowerCase().match(/\b(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+(\d{4})\b/);
  if (plWord) {
    const day = plWord[1].padStart(2, '0');
    const month = String(POLISH_MONTHS[plWord[2]]).padStart(2, '0');
    const year = plWord[3];
    const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  // RFC 2822 (RSS pubDate)
  const fallback = new Date(s);
  if (!Number.isNaN(fallback.getTime()) && fallback.getUTCFullYear() >= 1990 && fallback.getUTCFullYear() <= 2100) {
    return fallback.toISOString();
  }

  return null;
}

function extractMetaContent(html, attrName, attrValue) {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const r1 = new RegExp(`<meta[^>]+${attrName}=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i');
  const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${escaped}["']`, 'i');
  const m = html.match(r1) || html.match(r2);
  return m ? decodeEntities(m[1]).trim() : null;
}

function extractJsonLdDatesAndMeta(html) {
  const result = { title: null, publisher: null, published_at: null, updated_at: null };
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : parsed['@graph'] ? parsed['@graph'] : [parsed];
      for (const obj of items) {
        if (!obj || typeof obj !== 'object') continue;
        if (!result.title && typeof obj.headline === 'string') result.title = obj.headline.trim();
        if (!result.publisher && typeof obj.publisher?.name === 'string') result.publisher = obj.publisher.name.trim();
        if (!result.published_at && typeof obj.datePublished === 'string') {
          result.published_at = normalizeDateToIso(obj.datePublished);
        }
        if (!result.updated_at && typeof obj.dateModified === 'string') {
          result.updated_at = normalizeDateToIso(obj.dateModified);
        }
      }
    } catch {
      // Niepoprawny JSON-LD na stronie ignorujemy
    }
  }
  return result;
}

/**
 * Ekstrahuje linki do podstron z aktualnościami/komunikatami wyłącznie w obrębie dozwolonych hostów.
 */
function extractCandidateLinks(html, baseUrl, sourceRegistry) {
  const links = [];
  const seen = new Set();

  // Pomijamy nawigację główną/stopkę tam gdzie się da, skupiając się na treści głównej jeśli istnieje
  const mainMatch =
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    html.match(/<div[^>]+class=["'][^"']*(?:art-prev|article-area|content|main-content|news)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const scope = mainMatch ? mainMatch[1] : html;

  const aRegex = /<a\b[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of scope.matchAll(aRegex)) {
    const rawHref = decodeEntities(m[1]).trim();
    if (!rawHref || /^(mailto:|tel:|javascript:)/i.test(rawHref)) continue;
    if (/\.(pdf|zip|docx?|xlsx?|png|jpe?g|gif|svg|mp4|mp3)$/i.test(rawHref)) continue;

    let absUrl;
    try {
      absUrl = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }

    if (absUrl === baseUrl) continue;
    if (!sourceRegistry.isUrlAllowed(absUrl)) continue;
    if (seen.has(absUrl)) continue;

    const anchorText = stripHtmlToText(m[2]).replace(/\s+/g, ' ').trim();
    if (anchorText.length < 12) continue;
    if (/^(strona główna|mapa strony|kontakt|o nas|polityka prywatności|deklaracja dostępności|przejdź do|bip)$/i.test(anchorText)) {
      continue;
    }

    seen.add(absUrl);
    links.push({ url: absUrl, title: anchorText.slice(0, 220) });
  }

  return links;
}

/**
 * Adapter HTML: wyodrębnia tytuł, wydawcę, daty, treść i linki do podstron.
 */
function extractFromHtml(html, source, finalUrl, retrievedAt, sourceRegistry, fetchLimitations = []) {
  const limitations = [...fetchLimitations];
  const jsonLd = extractJsonLdDatesAndMeta(html);

  const ogTitle = extractMetaContent(html, 'property', 'og:title');
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Title = h1Match ? stripHtmlToText(h1Match[1]).replace(/\s+/g, ' ').trim() : null;
  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleTag = titleTagMatch ? decodeEntities(titleTagMatch[1]).replace(/\s+/g, ' ').trim() : null;

  const title = ogTitle || (h1Title && h1Title.length > 2 ? h1Title : null) || (titleTag && titleTag.length > 0 ? titleTag : null);

  const ogSiteName = extractMetaContent(html, 'property', 'og:site_name');
  const publisher = jsonLd.publisher || ogSiteName || source.name || null;

  let publishedAt =
    normalizeDateToIso(extractMetaContent(html, 'property', 'article:published_time')) ||
    normalizeDateToIso(extractMetaContent(html, 'name', 'date')) ||
    normalizeDateToIso(extractMetaContent(html, 'name', 'DC.date.issued')) ||
    jsonLd.published_at ||
    null;

  if (!publishedAt) {
    const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    if (timeMatch) publishedAt = normalizeDateToIso(timeMatch[1]);
  }
  if (!publishedAt) {
    // Szukamy jawnej daty artykułu gov.pl (np. <p class="event-date">21.11.2026</p> lub <span class="date">)
    const dateClassMatch = html.match(/<(?:p|span|div)[^>]+class=["'][^"']*(?:event-date|date|published|data-publikacji)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|span|div)>/i);
    if (dateClassMatch) {
      publishedAt = normalizeDateToIso(stripHtmlToText(dateClassMatch[1]));
    }
  }

  const updatedAt =
    normalizeDateToIso(extractMetaContent(html, 'property', 'article:modified_time')) ||
    jsonLd.updated_at ||
    null;

  // Wykrywanie SPA bez treści; dla zwykłych stron preferujemy zawartość <main> / <article> bez nawigacji
  const mainBlock =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    html;
  const scopedText = stripHtmlToText(mainBlock);
  const bodyText = scopedText.length >= 80 ? scopedText : stripHtmlToText(html);
  const isSpaEmpty =
    bodyText.length < 150 &&
    (/<app-root\b/i.test(html) || /<div[^>]+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i.test(html) || /data-beasties-container/i.test(html));

  if (isSpaEmpty) {
    limitations.push('Strona wymaga renderowania JavaScript (SPA) – w surowym HTML brak treści merytorycznej.');
  }

  if (!publishedAt) {
    limitations.push('Brak jednoznacznej daty publikacji w metadanych strony.');
  }

  // Dla stron pomiarowych HTML (np. GIOŚ) sprawdzamy obecność czasu pomiaru
  let observedAt = null;
  let measurementData = null;
  if (source.source_role === 'live_measurements') {
    const obsMatch = bodyText.match(/(?:stan\s+na|pomiar\s+z|aktualizacja\s+danych|data\s+pomiaru)[:\s]+(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?|\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/i);
    if (obsMatch) {
      observedAt = normalizeDateToIso(obsMatch[1]);
    } else {
      limitations.push('Nie udało się potwierdzić dokładnego czasu pomiaru w HTML – aktualność danych pomiarowych jest niepotwierdzona.');
    }
    measurementData = {
      observed_at: observedAt,
      retrieved_at: retrievedAt,
      source_name: source.name,
      unit: /µg\/m3|ug\/m3|µg\/m³/i.test(bodyText) ? 'µg/m³' : null,
      area: null,
      freshness_confirmed: Boolean(observedAt),
    };
  }

  const links = extractCandidateLinks(html, finalUrl, sourceRegistry);

  return {
    documents: [
      {
        source_id: source.source_id,
        source_url: source.source_url,
        url: finalUrl,
        title,
        publisher,
        published_at: publishedAt,
        updated_at: updatedAt,
        event_date: null,
        observed_at: observedAt,
        retrieved_at: retrievedAt,
        source_type: source.source_type,
        content_type: 'text/html',
        text: bodyText,
        retrieval_status: isSpaEmpty ? 'requires_js_rendering' : 'ok',
        measurement_data: measurementData,
        limitations,
      },
    ],
    links,
  };
}

/**
 * Adapter RSS 2.0 / Atom (np. CERT Polska, UTK).
 */
function parseFeedXml(xml, source, feedUrl, retrievedAt, sourceRegistry, fetchLimitations = []) {
  const documents = [];
  const isAtom = /<feed\b/i.test(xml) && /<entry\b/i.test(xml);
  const itemRegex = isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

  for (const m of xml.matchAll(itemRegex)) {
    const block = m[1];
    const titleRaw = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    const title = titleRaw ? stripHtmlToText(decodeEntities(titleRaw)).replace(/\s+/g, ' ').trim() : null;

    let itemUrl = null;
    if (isAtom) {
      const linkHref = (block.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1];
      if (linkHref) itemUrl = decodeEntities(linkHref).trim();
    } else {
      const linkTag = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1];
      if (linkTag) itemUrl = decodeEntities(linkTag).trim();
    }

    if (itemUrl) {
      try {
        itemUrl = new URL(itemUrl, feedUrl).href;
      } catch {
        itemUrl = null;
      }
    }

    // Bezwzględna weryfikacja hosta dla każdego elementu z kanału RSS!
    if (!itemUrl || !sourceRegistry.isUrlAllowed(itemUrl)) {
      itemUrl = feedUrl;
    }

    const pubRaw =
      (block.match(/<(?:pubDate|published|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|dc:date)>/i) || [])[1] || null;
    const updRaw = (block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1] || null;
    const descRaw =
      (block.match(/<(?:content:encoded|content|description|summary)[^>]*>([\s\S]*?)<\/(?:content:encoded|content|description|summary)>/i) || [])[1] ||
      '';

    const publishedAt = pubRaw ? normalizeDateToIso(decodeEntities(pubRaw)) : null;
    const updatedAt = updRaw ? normalizeDateToIso(decodeEntities(updRaw)) : null;
    const text = stripHtmlToText(decodeEntities(descRaw));
    const limitations = [...fetchLimitations];
    if (!publishedAt) limitations.push('Brak daty publikacji w wpisie RSS/Atom.');

    documents.push({
      source_id: source.source_id,
      source_url: source.source_url,
      url: itemUrl,
      title,
      publisher: source.name || null,
      published_at: publishedAt,
      updated_at: updatedAt,
      event_date: null,
      observed_at: null,
      retrieved_at: retrievedAt,
      source_type: source.source_type,
      content_type: 'application/rss+xml',
      text: [title, text].filter(Boolean).join('. '),
      retrieval_status: 'ok',
      measurement_data: null,
      limitations,
    });
  }

  return { documents, links: [] };
}

/**
 * Adapter JSON / API (gov.pl RSO proxy, WordPress REST API, PAA WFS GeoJSON, ogólny JSON).
 */
function parseJsonApi(jsonText, source, apiUrl, retrievedAt, sourceRegistry, fetchLimitations = []) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return {
      documents: [],
      links: [],
      parseError: 'Odpowiedź API nie jest poprawnym JSON-em.',
    };
  }

  const documents = [];

  // 1. gov.pl RSO JSON (/api/data/proxy/rso/komunikatyxml/...)
  if (source.api_adapter === 'gov_rso_json' || (data && Array.isArray(data.newses))) {
    for (const news of data.newses || []) {
      const validFrom = normalizeDateToIso(news.valid_from);
      const validTo = normalizeDateToIso(news.valid_to);
      const locationName = news.location_name || news.river_name || null;
      const alarmLevel = news.rso_alarm !== undefined && news.rso_alarm !== null ? String(news.rso_alarm) : null;
      const textParts = [
        news.title,
        news.shortcut,
        news.content ? stripHtmlToText(String(news.content)) : null,
        locationName ? `Obszar: ${locationName}.` : null,
        news.valid_from ? `Obowiązuje od: ${news.valid_from}.` : null,
        news.valid_to ? `Obowiązuje do: ${news.valid_to}.` : null,
      ].filter(Boolean);

      const limitations = [...fetchLimitations];
      if (!validFrom) limitations.push('Brak daty początku obowiązywania komunikatu RSO.');
      if (validTo && new Date(validTo).getTime() < new Date(retrievedAt).getTime()) {
        limitations.push(`Komunikat RSO wygasł (valid_to: ${validTo}).`);
      }

      documents.push({
        source_id: source.source_id,
        source_url: source.source_url,
        url: source.source_url,
        title: news.title || news.shortcut || null,
        publisher: source.name || 'gov.pl – Regionalny System Ostrzegania',
        published_at: validFrom,
        updated_at: null,
        event_date: validFrom,
        valid_to: validTo,
        observed_at: retrievedAt,
        retrieved_at: retrievedAt,
        source_type: source.source_type,
        content_type: 'application/json',
        text: textParts.join(' '),
        retrieval_status: 'ok',
        measurement_data: {
          observed_at: validFrom || retrievedAt,
          retrieved_at: retrievedAt,
          source_name: source.name,
          unit: news.water_level_value ? 'cm' : null,
          area: locationName,
          alarm_level: alarmLevel,
          valid_to: validTo,
        },
        limitations,
      });
    }
    return { documents, links: [] };
  }

  // 2. PAA WFS GeoJSON (bieżące pomiary mocy dawki promieniowania gamma)
  if (source.api_adapter === 'paa_wfs_geojson' || (data?.type === 'FeatureCollection' && Array.isArray(data.features))) {
    for (const feature of data.features || []) {
      const props = feature.properties || {};
      const station = props.stacja || props.tip_name || 'Nieznana stacja';
      const tipValue = props.tip_value || (props.moc_dawki !== undefined ? `${props.moc_dawki} µSv/h` : null);
      const observedAt = normalizeDateToIso(props.tip_date || props.d_kon_pom || props.d_pocz_pom);
      const limitations = [...fetchLimitations];
      if (!observedAt) {
        limitations.push('Brak znacznika czasu pomiaru stacji PAA – nie można potwierdzić aktualności odczytu.');
      }

      documents.push({
        source_id: source.source_id,
        source_url: source.source_url,
        url: apiUrl,
        title: `Pomiar radiacyjny PAA – stacja ${station}`,
        publisher: 'Państwowa Agencja Atomistyki (Monitoring radiacyjny)',
        published_at: observedAt,
        updated_at: observedAt,
        event_date: observedAt,
        observed_at: observedAt,
        retrieved_at: retrievedAt,
        source_type: source.source_type,
        content_type: 'application/geo+json',
        text: `Stacja pomiarowa PAA ${station}: moc dawki promieniowania gamma wynosi ${tipValue || 'brak wartości'} (czas pomiaru: ${props.tip_date || observedAt || 'nieznany'}).`,
        retrieval_status: 'ok',
        measurement_data: {
          observed_at: observedAt,
          retrieved_at: retrievedAt,
          source_name: 'PAA Monitoring Radiacyjny (PMS)',
          unit: 'µSv/h',
          value: tipValue,
          area: station,
          freshness_confirmed: Boolean(observedAt),
        },
        limitations,
      });
    }
    return { documents, links: [] };
  }

  // 3. WordPress REST API (np. kgsok.pl/wp-json/wp/v2/posts)
  if (source.api_adapter === 'wordpress_rest' || (Array.isArray(data) && data[0] && data[0].title?.rendered !== undefined)) {
    for (const post of Array.isArray(data) ? data : []) {
      const postUrl = post.link && sourceRegistry.isUrlAllowed(post.link) ? post.link : apiUrl;
      const title = post.title?.rendered ? stripHtmlToText(post.title.rendered).replace(/\s+/g, ' ').trim() : null;
      const body = post.content?.rendered
        ? stripHtmlToText(post.content.rendered)
        : post.excerpt?.rendered
          ? stripHtmlToText(post.excerpt.rendered)
          : '';
      const publishedAt = normalizeDateToIso(post.date_gmt || post.date);
      const updatedAt = normalizeDateToIso(post.modified_gmt || post.modified);
      const limitations = [...fetchLimitations];
      if (!publishedAt) limitations.push('Brak daty publikacji we wpisie API.');

      documents.push({
        source_id: source.source_id,
        source_url: source.source_url,
        url: postUrl,
        title,
        publisher: source.name || null,
        published_at: publishedAt,
        updated_at: updatedAt,
        event_date: null,
        observed_at: null,
        retrieved_at: retrievedAt,
        source_type: source.source_type,
        content_type: 'application/json',
        text: [title, body].filter(Boolean).join('. '),
        retrieval_status: 'ok',
        measurement_data: null,
        limitations,
      });
    }
    return { documents, links: [] };
  }

  // 4. Odyseusz REST API (odyseusz.gov.pl/api/v1/informacje/...)
  if (source.api_adapter === 'odyseusz_api' || (data && (Array.isArray(data.ostrzezeniaDlaPodrozujacych) || data.idProfiluPanstwa !== undefined || data.trescDlaczegoWarto !== undefined))) {
    // 4a. Słownik państw /profile-panstw/mini -> zwracany jako odyseuszCountries do dalszego pobrania w evidenceCollector
    if (Array.isArray(data) && data[0] && data[0].kodIso && data[0].nazwa) {
      return { documents: [], links: [], odyseuszCountries: data };
    }

    // 4b. Ostrzeżenia dla kraju (/api/v1/informacje/:kodIso/ostrzezenia)
    if (Array.isArray(data.ostrzezeniaDlaPodrozujacych) || data.bazowyKodOstrzezenia) {
      const isoMatch = apiUrl.match(/\/informacje\/([A-Z]{2})\/ostrzezenia/i);
      const isoCode = isoMatch ? isoMatch[1].toUpperCase() : '';
      const pubDate = normalizeDateToIso(data.dataObowiazywaniaOd);
      const parts = [];
      if (data.bazowyKodOstrzezenia) {
        parts.push(`Ogólny poziom ostrzeżenia MSZ (${isoCode}): ${data.bazowyKodOstrzezenia.replaceAll('_', ' ')}.`);
      }
      if (data.trescOstrzezeniaDlaKraju) {
        parts.push(stripHtmlToText(String(data.trescOstrzezeniaDlaKraju)).replace(/\s*\n+\s*/g, ' '));
      }
      for (const w of data.ostrzezeniaDlaPodrozujacych || []) {
        const levelDesc = w.poziomZagrozenia?.opis || w.poziomZagrozenia?.kod || '';
        const regions = (w.regiony || [])
          .map((r) => r.obszarAdministracyjny?.podzialAdministracyjny1 || r.obszarAdministracyjny?.podzialAdministracyjny2)
          .filter(Boolean);
        const flatTresc = w.tresc
          ? stripHtmlToText(String(w.tresc))
              .replace(/:\s*\r?\n\s*-\s*/g, ': ')
              .replace(/\r?\n\s*-\s*/g, ', ')
              .replace(/\s*\n+\s*/g, ' ')
              .replace(/\.\s+/g, '; ')
          : '';
        parts.push(
          [
            `Ostrzeżenie Ministerstwa Spraw Zagranicznych (MSZ Odyseusz, kod kraju ${isoCode})`,
            levelDesc ? `– ${levelDesc}:` : ':',
            flatTresc,
            regions.length ? `(regiony: ${regions.join(', ')})` : '',
            w.dataObowiazywaniaOd ? `[obowiązuje od: ${w.dataObowiazywaniaOd}].` : '.',
          ]
            .filter(Boolean)
            .join(' ')
        );
      }

      if (parts.length > 0) {
        documents.push({
          source_id: source.source_id,
          source_url: source.source_url,
          url: 'https://odyseusz.gov.pl/',
          title: `Ostrzeżenia MSZ dla podróżujących (Odyseusz – ${isoCode || apiUrl.split('/').slice(-2).join('/')})`,
          publisher: 'Ministerstwo Spraw Zagranicznych – System Odyseusz',
          published_at: pubDate,
          updated_at: pubDate,
          event_date: pubDate,
          observed_at: retrievedAt,
          retrieved_at: retrievedAt,
          source_type: source.source_type,
          content_type: 'application/json',
          text: parts.join(' '),
          retrieval_status: 'ok',
          measurement_data: null,
          limitations: [...fetchLimitations, ...(pubDate ? [] : ['Brak daty publikacji ostrzeżenia.'])],
        });
      }
      return { documents, links: [] };
    }

    // 4c. Pełny profil państwa (/api/v1/informacje/profile-panstw/:kodIso)
    if (data.idProfiluPanstwa !== undefined || data.nazwa) {
      const countryName = data.nazwa || data.kodISO || 'Państwo';
      const pubDate = normalizeDateToIso(data.dataAktualizacji);

      if (Array.isArray(data.ostrzezenia) && data.ostrzezenia.length > 0) {
        const warnTexts = data.ostrzezenia.map((w) => {
          const lvl = w.poziomZagrozenia?.opis || w.poziomZagrozenia?.kod || '';
          const flat = stripHtmlToText(String(w.tresc || ''))
            .replace(/:\s*\r?\n\s*-\s*/g, ': ')
            .replace(/\r?\n\s*-\s*/g, ', ')
            .replace(/\s*\n+\s*/g, ' ')
            .replace(/\.\s+/g, '; ');
          return `Ostrzeżenie Ministerstwa Spraw Zagranicznych (MSZ Odyseusz) dla państwa ${countryName} (${lvl}): ${flat}.`;
        });
        documents.push({
          source_id: source.source_id,
          source_url: source.source_url,
          url: 'https://odyseusz.gov.pl/',
          title: `MSZ Odyseusz – Ostrzeżenia dla podróżujących: ${countryName}`,
          publisher: 'Ministerstwo Spraw Zagranicznych – System Odyseusz',
          published_at: pubDate,
          updated_at: pubDate,
          event_date: pubDate,
          observed_at: retrievedAt,
          retrieved_at: retrievedAt,
          source_type: source.source_type,
          content_type: 'application/json',
          text: warnTexts.join(' '),
          retrieval_status: 'ok',
          measurement_data: null,
          limitations: [...fetchLimitations],
        });
      }

      // Aktualności dla kraju (na stronie Odyseusza: ramka "Aktualności" / "Ostatnia aktualizacja"),
      // np. zapowiedź strajku generalnego, zamieszek, zamknięcia lotnisk. To najświeższe informacje MSZ.
      const aktualnosci = stripHtmlToText(String(data.trescPowiadomieniaDluga || data.trescPowiadomieniaKrotka || '')).trim();
      if (aktualnosci.length > 30) {
        documents.push({
          source_id: source.source_id,
          source_url: source.source_url,
          url: 'https://odyseusz.gov.pl/',
          title: `MSZ Odyseusz – ${countryName}: Aktualności`,
          publisher: 'Ministerstwo Spraw Zagranicznych – System Odyseusz',
          published_at: pubDate,
          updated_at: pubDate,
          event_date: pubDate,
          observed_at: retrievedAt,
          retrieved_at: retrievedAt,
          source_type: source.source_type,
          content_type: 'application/json',
          text: `Państwo: ${countryName} (Aktualności MSZ). ${aktualnosci}`,
          retrieval_status: 'ok',
          measurement_data: null,
          limitations: [...fetchLimitations],
        });
      }

      for (const sekcja of data.sekcje || []) {
        const secName = sekcja.zakresInformacyjny?.opis || sekcja.zakresInformacyjny?.kod || 'Informacje';
        const subTexts = (sekcja.podsekcje || []).map((ps) => `${ps.tytul || ''}: ${stripHtmlToText(String(ps.tresc || ''))}`);
        const fullSecText = [
          `Państwo: ${countryName} (${secName}).`,
          sekcja.podsumowanie ? stripHtmlToText(String(sekcja.podsumowanie)) : '',
          sekcja.tresc ? stripHtmlToText(String(sekcja.tresc)) : '',
          ...subTexts,
        ]
          .filter(Boolean)
          .join(' ');

        if (fullSecText.length > 30) {
          documents.push({
            source_id: source.source_id,
            source_url: source.source_url,
            url: 'https://odyseusz.gov.pl/',
            title: `MSZ Odyseusz – ${countryName}: ${secName}`,
            publisher: 'Ministerstwo Spraw Zagranicznych – System Odyseusz',
            published_at: pubDate,
            updated_at: pubDate,
            event_date: null,
            observed_at: retrievedAt,
            retrieved_at: retrievedAt,
            source_type: source.source_type,
            content_type: 'application/json',
            text: fullSecText,
            retrieval_status: 'ok',
            measurement_data: null,
            limitations: [...fetchLimitations],
          });
        }
      }

      return { documents, links: [] };
    }
  }

  // 4. Ogólny JSON fallback
  const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [data];
  for (const item of items.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const itemUrl =
      typeof item.url === 'string' && sourceRegistry.isUrlAllowed(item.url) ? item.url : apiUrl;
    const title = typeof item.title === 'string' ? item.title.trim() : null;
    const publishedAt = normalizeDateToIso(item.published_at || item.date || item.created_at || null);
    const text =
      typeof item.content === 'string'
        ? stripHtmlToText(item.content)
        : typeof item.description === 'string'
          ? stripHtmlToText(item.description)
          : JSON.stringify(item).slice(0, 1000);

    documents.push({
      source_id: source.source_id,
      source_url: source.source_url,
      url: itemUrl,
      title,
      publisher: source.name || null,
      published_at: publishedAt,
      updated_at: normalizeDateToIso(item.updated_at || null),
      event_date: normalizeDateToIso(item.event_date || null),
      observed_at: normalizeDateToIso(item.observed_at || null),
      retrieved_at: retrievedAt,
      source_type: source.source_type,
      content_type: 'application/json',
      text,
      retrieval_status: 'ok',
      measurement_data: null,
      limitations: [...fetchLimitations, ...(publishedAt ? [] : ['Brak daty publikacji w danych JSON.'])],
    });
  }

  return { documents, links: [] };
}

/**
 * Automatycznie wybiera odpowiedni adapter na podstawie Content-Type i struktury odpowiedzi.
 */
function extractContent(fetchResult, source, sourceRegistry) {
  const ct = (fetchResult.contentType || '').toLowerCase();
  const body = fetchResult.body || '';
  const looksLikeHtml = /^\s*<!doctype\s+html|^\s*<html\b/i.test(body);

  if (
    !looksLikeHtml &&
    (ct.includes('json') ||
      source.access_method === 'json_api' ||
      source.access_method === 'live_measurements_api' ||
      (/^\s*[\[{]/.test(body) && /[\]}]\s*$/.test(body)))
  ) {
    return parseJsonApi(body, source, fetchResult.finalUrl, fetchResult.retrievedAt, sourceRegistry, fetchResult.limitations);
  }

  if (ct.includes('xml') || ct.includes('rss') || ct.includes('atom') || /^\s*<\?xml|<rss\b|<feed\b/i.test(body)) {
    return parseFeedXml(body, source, fetchResult.finalUrl, fetchResult.retrievedAt, sourceRegistry, fetchResult.limitations);
  }

  return extractFromHtml(body, source, fetchResult.finalUrl, fetchResult.retrievedAt, sourceRegistry, fetchResult.limitations);
}

const COUNTRY_ALIAS_PATTERNS = [
  { iso: 'EG', regex: /\b(egip\w*|synaj\w*|kair\w*|hurghad\w*|szarm\w*|halaib\w*|asuan\w*)\b/i },
  { iso: 'IL', regex: /\b(izrael\w*|tel\s+awiw\w*|jerozolim\w*|gaz[ayę])\b/i },
  { iso: 'UA', regex: /\b(ukrain\w*|kijów|kijow\w*|lwów|lwow\w*)\b/i },
  { iso: 'RU', regex: /\b(rosj\w*|rosyjsk\w*|moskw\w*)\b/i },
  { iso: 'BY', regex: /\b(białoru\w*|mińsk\w*)\b/i },
  { iso: 'DE', regex: /\b(niemc\w*|niemie\w*|berlin\w*)\b/i },
  { iso: 'FR', regex: /\b(francj\w*|francu\w*|paryż\w*)\b/i },
  { iso: 'IT', regex: /\b(włoch\w*|włosz\w*|włosk\w*|rzym\w*)\b/i },
  { iso: 'ES', regex: /\b(hiszpani\w*|hiszpańsk\w*|madryt\w*)\b/i },
  { iso: 'GB', regex: /\b(wielk\w*\s+brytani\w*|brytyjsk\w*|angli\w*|londyn\w*|\buk\b)\b/i },
  { iso: 'US', regex: /\b(stan\w*\s+zjednoczon\w*|\busa\b|ameryk\w*|waszyngton\w*)\b/i },
  { iso: 'TR', regex: /\b(turcj\w*|tureck\w*|stambuł\w*|ankara|antaly\w*)\b/i },
  { iso: 'GR', regex: /\b(grecj\w*|greck\w*|aten\w*)\b/i },
  { iso: 'HR', regex: /\b(chorwac\w*|zagrzeb\w*)\b/i },
  { iso: 'TH', regex: /\b(tajlandi\w*|bangkok\w*)\b/i },
  { iso: 'JP', regex: /\b(japoni\w*|japońsk\w*|tokio)\b/i },
  { iso: 'CN', regex: /\b(chin\w*|chińsk\w*|pekin\w*)\b/i },
  { iso: 'LT', regex: /\b(litw\w*|litew\w*|wiln\w*)\b/i },
  { iso: 'LV', regex: /\b(łotw\w*|łotew\w*|ryg[aię])\b/i },
  { iso: 'EE', regex: /\b(estoni\w*|estońsk\w*|tallinn\w*)\b/i },
  { iso: 'CZ', regex: /\b(czech\w*|czesk\w*|prag[aię]|pradze)\b/i },
  { iso: 'SK', regex: /\b(słowac\w*|bratysław\w*)\b/i },
  { iso: 'HU', regex: /\b(węgier\w*|węgrz\w*|budapeszt\w*)\b/i },
  { iso: 'LB', regex: /\b(liban\w*|bejrut\w*)\b/i },
  { iso: 'IR', regex: /\b(iran\w*|irańsk\w*|teheran\w*)\b/i },
  { iso: 'IQ', regex: /\b(irak\w*|irack\w*|bagdad\w*)\b/i },
  { iso: 'SY', regex: /\b(syri\w*|syryjsk\w*|damaszk\w*)\b/i },
  { iso: 'JO', regex: /\b(jordani\w*|amman\w*)\b/i },
  { iso: 'MA', regex: /\b(marok\w*|rabat\w*|marrakesz\w*)\b/i },
  { iso: 'TN', regex: /\b(tunezj\w*|tunis\w*)\b/i },
  { iso: 'AE', regex: /\b(emirat\w*|dubaj\w*|abu\s+zabi)\b/i },
  { iso: 'GE', regex: /\b(gruzj\w*|tbilisi)\b/i },
];

/**
 * Dopasowuje kody ISO państw z oficjalnego słownika Odyseusza (/api/v1/informacje/profile-panstw/mini)
 * do tekstu twierdzenia.
 */
function matchCountriesFromOdyseuszDict(countriesList, claimText) {
  const text = String(claimText || '').toLowerCase();
  const matchedIsos = new Set();

  for (const alias of COUNTRY_ALIAS_PATTERNS) {
    if (alias.regex.test(text)) {
      matchedIsos.add(alias.iso);
    }
  }

  for (const entry of Array.isArray(countriesList) ? countriesList : []) {
    if (!entry?.kodIso || !entry?.nazwa) continue;
    const nameLower = String(entry.nazwa).toLowerCase();
    const stem = nameLower.length >= 5 ? nameLower.slice(0, Math.max(4, Math.floor(nameLower.length * 0.72))) : nameLower;
    if (stem.length >= 4 && text.includes(stem)) {
      matchedIsos.add(entry.kodIso.toUpperCase());
    }
  }

  const byIso = new Map((Array.isArray(countriesList) ? countriesList : []).map((c) => [String(c.kodIso).toUpperCase(), c.nazwa]));
  return [...matchedIsos].map((iso) => ({
    kodIso: iso,
    nazwa: byIso.get(iso) || iso,
  }));
}

module.exports = {
  decodeEntities,
  stripHtmlToText,
  normalizeDateToIso,
  extractCandidateLinks,
  extractFromHtml,
  parseFeedXml,
  parseJsonApi,
  extractContent,
  matchCountriesFromOdyseuszDict,
};
