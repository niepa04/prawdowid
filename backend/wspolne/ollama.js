// ollama.js - wspólne wywołanie modelu językowego (Ollama /api/chat) zwracające JSON.
// Adres serwera i modele: config/modele.js

const { OLLAMA_URL, MODELE } = require('../../config/modele');

function bazowyUrl(surowy) {
  return String(surowy || OLLAMA_URL)
    .trim()
    .replace(/\/api\/(generate|chat)\/?$/i, '')
    .replace(/\/+$/, '');
}

/**
 * @param {{system: string, user: string, model?: string, numCtx?: number, numPredict?: number,
 *          timeoutMs?: number, fetchImpl?: Function, ollamaUrl?: string, proby?: number}} p
 * @returns {Promise<object>} sparsowany JSON z odpowiedzi modelu
 */
async function zapytajModelJson(p) {
  const fetchFn = p.fetchImpl || fetch;
  const proby = Math.max(1, p.proby || 2);
  let ostatni;
  for (let i = 0; i < proby; i++) {
    try {
      const odp = await fetchFn(`${bazowyUrl(p.ollamaUrl)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(p.timeoutMs || 120000),
        body: JSON.stringify({
          model: p.model || MODELE.analiza,
          stream: false,
          think: false,
          format: 'json',
          options: { temperature: 0, num_ctx: p.numCtx || 8192, num_predict: p.numPredict || 800 },
          messages: [
            { role: 'system', content: p.system },
            { role: 'user', content: p.user },
          ],
        }),
      });
      if (!odp.ok) throw new Error(`Ollama HTTP ${odp.status}`);
      const dane = await odp.json();
      if (dane?.done === false) throw new Error(`odpowiedź niedokończona (${dane.done_reason || '?'})`);
      return JSON.parse(dane?.message?.content ?? dane?.response);
    } catch (err) {
      ostatni = err;
      // Po przekroczeniu czasu nie ponawiamy - druga próba tylko podwoiłaby czekanie.
      // Ponawiamy przy błędach HTTP i niepoprawnym JSON-ie.
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') break;
    }
  }
  throw ostatni;
}

module.exports = { zapytajModelJson, bazowyUrl };
