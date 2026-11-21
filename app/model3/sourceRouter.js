// sourceRouter.js - Inteligentny routing tematyczny twierdzeń do zaufanych źródeł

const CATEGORY_RULES = [
  {
    category: 'travel_foreign_affairs',
    label: 'Podróże i sprawy zagraniczne',
    patterns: [
      /\bmsz\b/i,
      /\bodyseusz\w*/i,
      /podróż\w*/i,
      /wyjazd\w*\s+(za\s+granic|zagraniczn)/i,
      /odradz\w*\s+podróż/i,
      /konsul\w*/i,
      /ambasad\w*/i,
      /ewakuacj\w*\s+obywatel/i,
      /dyplomacj\w*/i,
      /paszport\w*|wiz[ayę]\b/i,
      /za\s+granic[ąę]/i,
    ],
  },
  {
    category: 'warnings_crisis',
    label: 'Ostrzeżenia i zarządzanie kryzysowe',
    patterns: [
      /\brcb\b/i,
      /\brso\b/i,
      /alert\w*/i,
      /ostrzeżen\w*/i,
      /raport\w*\s+dobow\w*/i,
      /kryzys\w*/i,
      /zagrożen\w*/i,
      /ewakuacj\w*/i,
      /stan\w*\s+alarmow\w*|stan\w*\s+ostrzegawcz\w*/i,
      /sytuacj\w*\s+kryzysow\w*/i,
    ],
  },
  {
    category: 'public_safety_services',
    label: 'Bezpieczeństwo publiczne i służby',
    patterns: [
      /\bpolicj\w*/i,
      /\bpsp\b|straż\w*\s+pożarn\w*/i,
      /\bmon\b|ministerstw\w*\s+obrony/i,
      /\bmswia\b/i,
      /\bwojsk\w*|sił\w*\s+zbrojn\w*|\bnato\b|żołnierz\w*/i,
      /dron\w*|przestrzen\w*\s+powietrzn\w*|granic\w*/i,
      /pożar\w*|czad\w*|tlenek\s+węgla|interwencj\w*/i,
      /zatrzyman\w*|aresztow\w*|poszukiwan\w*|przestęp\w*|służb\w*/i,
      /bezpieczeństw\w*\s+państw\w*/i,
    ],
  },
  {
    category: 'health_nuclear',
    label: 'Zdrowie i bezpieczeństwo jądrowe',
    patterns: [
      /\bgis\b|sanepid\w*|inspektorat\w*\s+sanitarn\w*/i,
      /\bpaa\b|agencj\w*\s+atomistyk\w*/i,
      /promieniowan\w*|radiac\w*|radiacyjn\w*|skażen\w*\s+promieniotwórcz\w*/i,
      /moc\w*\s+dawk\w*|µsv|mikrosiwert|jądrow\w*|atomow\w*|elektrown\w*\s+jądrow\w*/i,
      /żywnośc\w*|wycofan\w*\s+(parti|produkt)|salmonell\w*|listeri\w*|zatruci\w*/i,
      /sanitarn\w*|epidemi\w*|zdrowotn\w*|chorob\w*\s+zakaźn\w*/i,
    ],
  },
  {
    category: 'environment_weather_hydro',
    label: 'Środowisko, pogoda i hydrologia',
    patterns: [
      /\bimgw\b/i,
      /\bgioś\b|\bgios\b/i,
      /jakośc\w*\s+powietrz\w*|powietrz\w*|smog\w*|pm\s*10|pm\s*2[.,]5|pył\w*|zanieczyszczen\w*/i,
      /pogod\w*|meteorolog\w*|burz\w*|wiatr\w*|wichur\w*|opad\w*|ulew\w*|grad\w*|mróz|mroz\w*|upał\w*|gołoled\w*|śnieżyc\w*|mgł\w*/i,
      /hydrolog\w*|powód\w*|powodzi\w*|podtopien\w*|wezbran\w*|stan\w*\s+wód|susz\w*/i,
      /bałtyk\w*|sztorm\w*|falowan\w*|wybrzeż\w*/i,
    ],
  },
  {
    category: 'cybersecurity',
    label: 'Cyberbezpieczeństwo',
    patterns: [
      /\bcert\b|\bnask\b/i,
      /phishing\w*|smishing\w*|vishing\w*/i,
      /cyber\w*|haker\w*|malware|ransomware|trojan\w*|wirus\w*\s+komputer/i,
      /fałszyw\w*\s+(sms|wiadomośc|mail|stron|link|reklam)/i,
      /oszustw\w*\s+(internetow|sieciow|online|bankow|na\s+blik)/i,
      /wyłudzen\w*|podatnośc\w*|wyciek\w*\s+danych|kampani\w*\s+phishing/i,
    ],
  },
  {
    category: 'transport_infrastructure',
    label: 'Transport i infrastruktura',
    patterns: [
      /\bgddkia\b|\bulc\b|\butk\b|\bpkp\b|\bkgsok\b/i,
      /autostrad\w*|\b[as]\d{1,2}\b|\bdk\s*\d{1,2}\b/i,
      /utrudnien\w*\s+(drogow|w\s+ruchu|na\s+drodz|kolejow)/i,
      /zamknięc\w*\s+(drog|autostrad|pasa|trasy|przejazd)/i,
      /drog\w*\s+(krajow|ekspresow)|wypad\w*\s+(drogow|na\s+autostrad|na\s+[as]\d)/i,
      /kolej\w*|pociąg\w*|dworc\w*|rozklad\w*|rozkład\w*|opóźnien\w*\s+(pociąg|lot)/i,
      /lotnictw\w*|lotnisk\w*|samolot\w*|odwołan\w*\s+lot|praw\w*\s+pasażer/i,
      /infrastruktur\w*|transport\w*|korytarz\w*\s+transportow\w*/i,
    ],
  },
  {
    category: 'maritime_waterways',
    label: 'Bezpieczeństwo morskie i drogi wodne',
    patterns: [
      /\bsar\b|ratownictw\w*\s+morski\w*/i,
      /urząd\w*\s+morski\w*|urzęd\w*\s+morski\w*/i,
      /wody\s+polski\w*|wód\s+polskich/i,
      /komunikat\w*\s+nawigacyjn\w*|warunk\w*\s+żeglug\w*|żeglug\w*/i,
      /drog\w*\s+wodn\w*|szlak\w*\s+wodn\w*|śluza|śluz\w*|port\w*\s+morski\w*|tor\w*\s+wodn\w*/i,
      /bezpieczeństw\w*\s+morski\w*|rozlew\w*\s+olejow\w*/i,
    ],
  },
  {
    category: 'government_admin',
    label: 'Informacje administracji rządowej',
    patterns: [
      /\bkprm\b|kancelari\w*\s+premier\w*/i,
      /\bpremier\w*|rad\w*\s+ministrów|\brząd\w*\b/i,
      /ustaw\w*|rozporządzen\w*|komunikat\w*\s+rządow\w*|minister\w*/i,
    ],
  },
];

// Reguły podbijające konkretne źródła przy silnym sygnale instytucji/regionu/tematu
const SPECIFIC_SOURCE_BOOSTS = [
  { regex: /mazowieck\w*|warszaw\w*/i, sourceIds: ['SRC003', 'SRC008'], boost: 4 },
  { regex: /\bimgw\b|pogod\w*|wiatr\w*|burz\w*|opad\w*|ulew\w*|mróz|upał/i, sourceIds: ['SRC034', 'SRC002', 'SRC037', 'SRC005'], boost: 5 },
  { regex: /hydrolog\w*|powód\w*|powodzi\w*|stan\w*\s+wód|rzek\w*|wisł\w*|odr\w*/i, sourceIds: ['SRC035', 'SRC002', 'SRC033', 'SRC037'], boost: 5 },
  { regex: /bałtyk\w*|sztorm\w*|wybrzeż\w*/i, sourceIds: ['SRC036', 'SRC031', 'SRC032', 'SRC030'], boost: 5 },
  { regex: /pm\s*10|pm\s*2[.,]5|smog\w*|jakośc\w*\s+powietrz\w*|pył\w*|\bgioś\b|\bgios\b/i, sourceIds: ['SRC013', 'SRC002', 'SRC037'], boost: 6 },
  { regex: /\bcert\b|phishing\w*|oszustw\w*\s+internet|cyber\w*|fałszyw\w*\s+sms|malware/i, sourceIds: ['SRC014', 'SRC007'], boost: 7 },
  { regex: /\bgddkia\b|autostrad\w*|\b[as]\d{1,2}\b|utrudnien\w*\s+drogow|zamknięc\w*\s+drog/i, sourceIds: ['SRC020', 'SRC021', 'SRC022', 'SRC002', 'SRC016'], boost: 6 },
  { regex: /kolej\w*|pociąg\w*|\bpkp\b|\butk\b|\bkgsok\b|dworc\w*/i, sourceIds: ['SRC028', 'SRC027', 'SRC029', 'SRC016'], boost: 6 },
  { regex: /\bulc\b|lotnictw\w*|samolot\w*|lotnisk\w*|odwołan\w*\s+lot/i, sourceIds: ['SRC024', 'SRC025', 'SRC016', 'SRC017'], boost: 6 },
  { regex: /praw\w*\s+pasażer/i, sourceIds: ['SRC017', 'SRC025', 'SRC026', 'SRC028'], boost: 6 },
  { regex: /\bmsz\b|\bodyseusz\w*|podróż\w*\s+(do|za)|odradz\w*\s+podróż/i, sourceIds: ['SRC039', 'SRC001'], boost: 7 },
  { regex: /\bgis\b|sanepid\w*|żywnośc\w*|wycofan\w*\s+(produkt|parti)|salmonell\w*/i, sourceIds: ['SRC010', 'SRC002'], boost: 7 },
  { regex: /\bpaa\b|promieniowan\w*|radiac\w*|jądrow\w*|moc\w*\s+dawk\w*|atomistyk/i, sourceIds: ['SRC012', 'SRC011', 'SRC037'], boost: 7 },
  { regex: /\bmon\b|wojsk\w*|dron\w*|\bnato\b|obron\w*\s+narodow/i, sourceIds: ['SRC009', 'SRC038', 'SRC037'], boost: 6 },
  { regex: /\bpolicj\w*|zatrzyman\w*|poszukiwan\w*/i, sourceIds: ['SRC007', 'SRC008', 'SRC038'], boost: 5 },
  { regex: /\bpsp\b|straż\w*\s+pożarn\w*|pożar\w*|czad/i, sourceIds: ['SRC006', 'SRC037', 'SRC038'], boost: 6 },
  { regex: /gdyni\w*|gdańsk\w*|zatok\w*\s+gdańsk/i, sourceIds: ['SRC031'], boost: 5 },
  { regex: /szczecin\w*|świnoujści\w*/i, sourceIds: ['SRC032'], boost: 5 },
  { regex: /wody\s+polski|komunikat\w*\s+nawigacyjn|śluza|żeglug\w*\s+śródlądow/i, sourceIds: ['SRC033'], boost: 6 },
  { regex: /\bsar\b|ratownictw\w*\s+morski/i, sourceIds: ['SRC030', 'SRC031', 'SRC032'], boost: 5 },
  { regex: /\brcb\b|raport\w*\s+dobow/i, sourceIds: ['SRC005', 'SRC037', 'SRC002'], boost: 6 },
  { regex: /\bpremier\w*|\bkprm\b|rad\w*\s+ministrów/i, sourceIds: ['SRC040'], boost: 5 },
  { regex: /infolini\w*|numer\s+telefon|19\s*111|dane\s+kontaktowe/i, sourceIds: ['SRC018', 'SRC019', 'SRC023'], boost: 6 },
];

const CONTACT_INTENT_REGEX = /infolini\w*|numer\s+telefon|dane\s+kontaktowe|adres\s+ministerstw|19\s*111|epuap/i;
const GUIDE_INTENT_REGEX = /praw\w*\s+pasażer|odszkodowan\w*|reklamacj\w*|jak\s+działa\s+rso|poradnik/i;

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .replace(/[^a-ząćęłńóśźż0-9\s-]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/**
 * Buduje pełny kontekst tekstowy twierdzenia z uwzględnieniem relacji related_to (w obie strony).
 */
function buildClaimContextText(claim, allClaims = []) {
  const parts = [claim.claim || ''];
  if (claim.subject) parts.push(claim.subject);
  if (claim.object) parts.push(claim.object);
  if (claim.source_text) parts.push(claim.source_text);
  if (claim.value) parts.push(claim.value);

  const byId = new Map(allClaims.map((c) => [c.id, c]));

  // Powiązania wychodzące (np. temporal_qualifier -> event)
  if (Array.isArray(claim.related_to)) {
    for (const refId of claim.related_to) {
      const target = byId.get(refId);
      if (target && target.claim) parts.push(target.claim);
    }
  }

  // Powiązania przychodzące (np. event <- location "Mazowieckie", temporal "wieczorem")
  for (const other of allClaims) {
    if (other.id !== claim.id && Array.isArray(other.related_to) && other.related_to.includes(claim.id)) {
      if (other.claim) parts.push(other.claim);
      if (other.value) parts.push(other.value);
    }
  }

  return parts.join(' ');
}

/**
 * Dobiera odpowiednie źródła z rejestru dla pojedynczego twierdzenia z Modelu 2.
 */
function routeClaimToSources(claim, allClaims, sourceRegistry, options = {}) {
  const maxSources = options.maxSourcesPerClaim || 6;
  const contextText = buildClaimContextText(claim, allClaims);
  const tokens = new Set(tokenize(contextText));
  const isContactQuery = CONTACT_INTENT_REGEX.test(contextText);
  const isGuideQuery = GUIDE_INTENT_REGEX.test(contextText);

  // Dla czystych opinii i zdań nieweryfikowalnych bez powiązania z faktem
  const hasRelatedFact =
    Array.isArray(claim.related_to) &&
    claim.related_to.some((id) => {
      const ref = allClaims.find((c) => c.id === id);
      return ref && ref.type !== 'opinion' && ref.type !== 'non_verifiable';
    });

  if ((claim.type === 'opinion' || claim.type === 'non_verifiable') && !hasRelatedFact) {
    return {
      matchedCategories: [],
      selectedSources: [],
      noSuitableSource: true,
      routingNote: `Twierdzenie ma typ "${claim.type}" bez bezpośredniego powiązania z faktem weryfikowalnym w oficjalnych źródłach.`,
    };
  }

  // 1. Dopasowanie kategorii tematycznych
  const categoryScores = new Map();
  for (const rule of CATEGORY_RULES) {
    let hits = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(contextText)) hits++;
    }
    if (hits > 0) {
      categoryScores.set(rule.category, hits);
    }
  }

  // 2. Specyficzne podbicia dla konkretnych źródeł
  const specificBoostMap = new Map();
  for (const boostRule of SPECIFIC_SOURCE_BOOSTS) {
    if (boostRule.regex.test(contextText)) {
      for (const sid of boostRule.sourceIds) {
        specificBoostMap.set(sid, (specificBoostMap.get(sid) || 0) + boostRule.boost);
      }
    }
  }

  const matchedCategories = [...categoryScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);

  // 3. Punktacja każdego aktywnego źródła z katalogu
  const scored = [];
  for (const source of sourceRegistry.enabledSources) {
    // Odrzucamy strony czysto kontaktowe, chyba że twierdzenie dotyczy kontaktu/infolinii
    if (source.source_role === 'contact_info' && !isContactQuery) {
      continue;
    }

    let score = 0;
    const reasons = [];

    if (categoryScores.has(source.category)) {
      const catHits = categoryScores.get(source.category);
      score += 4 + Math.min(catHits * 2, 6);
      reasons.push(`kategoria:${source.category}`);
    }

    for (const secCat of source.secondary_categories || []) {
      if (categoryScores.has(secCat)) {
        score += 2.5;
        reasons.push(`kategoria_wtorna:${secCat}`);
      }
    }

    const boost = specificBoostMap.get(source.source_id) || 0;
    if (boost > 0) {
      score += boost;
      reasons.push('dopasowanie_instytucji_lub_tematu');
    }

    // Dopasowanie słów kluczowych z listy topics źródła
    let topicMatches = 0;
    for (const topic of source.topics || []) {
      const normTopic = normalizeText(topic);
      if (normTopic.length >= 3 && normalizeText(contextText).includes(normTopic)) {
        topicMatches++;
      } else {
        const topicTokens = tokenize(topic);
        if (topicTokens.length > 0 && topicTokens.every((t) => tokens.has(t))) {
          topicMatches++;
        }
      }
    }
    if (topicMatches > 0) {
      score += Math.min(topicMatches * 2, 6);
      reasons.push(`tematy(${topicMatches})`);
    }

    if (score <= 0) continue;

    // Premia za rolę źródła dopasowaną do typu zapytania
    if (source.source_role === 'warnings' || source.source_role === 'live_measurements') {
      score += 1.5;
    } else if (source.source_role === 'news_alerts') {
      score += 1.0;
    } else if (source.source_role === 'guide' && isGuideQuery) {
      score += 3.0;
    } else if ((source.source_role === 'guide' || source.source_role === 'informational') && !isGuideQuery && !isContactQuery) {
      // Obniżamy strony czysto informacyjne/poradnikowe przy weryfikacji incydentów
      score -= 2.5;
    }

    // Delikatna premia za wyższy priorytet (1 = najwyższy)
    score += Math.max(0, (5 - (source.priority || 3)) * 0.4);

    // Premia za działające źródło, przy zachowaniu widoczności ważnych źródeł z ograniczeniami
    // (aby uczciwie raportować blokady WAF / SPA / TLS zamiast je ukrywać)
    if (source.accessibility_status === 'accessible') {
      score += 2.0;
    }

    if (score > 0.5) {
      scored.push({
        source,
        score: Number(score.toFixed(2)),
        reasons,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.source.priority - b.source.priority);

  // Nie wysyłamy do wszystkich 40 źródeł i nie marnujemy wszystkich slotów
  // na wiele zablokowanych/niedostępnych adresów tego samego hosta (np. 3x drogi.gddkia.gov.pl)
  const selected = [];
  const unavailableHostCount = new Map();
  for (const item of scored) {
    if (selected.length >= maxSources) break;
    const isAccessible = item.source.accessibility_status === 'accessible';
    if (!isAccessible) {
      const count = unavailableHostCount.get(item.source.hostname) || 0;
      if (count >= 1) continue;
      unavailableHostCount.set(item.source.hostname, count + 1);
    }
    selected.push(item);
  }

  if (selected.length === 0) {
    return {
      matchedCategories,
      selectedSources: [],
      noSuitableSource: true,
      routingNote: 'Brak odpowiedniego źródła w katalogu 40 oficjalnych źródeł dla tematyki tego twierdzenia.',
    };
  }

  return {
    matchedCategories,
    selectedSources: selected.map((s) => s.source),
    scoredSelection: selected.map((s) => ({
      source_id: s.source.source_id,
      score: s.score,
      reasons: s.reasons,
    })),
    noSuitableSource: false,
    routingNote: null,
  };
}

module.exports = {
  CATEGORY_RULES,
  buildClaimContextText,
  routeClaimToSources,
};
