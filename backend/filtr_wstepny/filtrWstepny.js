// filtrWstepny.js - zatrzymuje zgłoszenia, których nie da się sensownie sprawdzić, ZANIM trafią do analizy.
//
// Bez tego spam, bełkot czy small talk przechodzą do researchu, a system "wypluwa" werdykt
// na siłę. Dwa etapy:
// 1. Szybkie reguły (bez modelu): za krótki tekst, brak liter, powtarzane znaki, sam link bez treści.
// 2. Krótka klasyfikacja modelem językowym: czy w tekście jest teza o faktach do sprawdzenia
//    (oraz czy nie ma w nim danych osobowych osoby prywatnej).
// Opinie PRZECHODZĄ (system oznaczy je jako "Nie podlega weryfikacji" z uzasadnieniem).
// Przy awarii modelu zgłoszenie przechodzi dalej - filtr nie może blokować prawdziwych tez.
// Prompt: config/prompty/filtrWstepny.js, model i parametry: config/modele.js (ZADANIA.filtrWstepny)

const { OLLAMA_URL, ZADANIA } = require('../../config/modele');

const KATEGORIE = {
  teza: 'teza do sprawdzenia',
  spam: 'spam lub reklama',
  belkot: 'bełkot lub przypadkowe znaki',
  brak_tezy: 'brak tezy do sprawdzenia',
  polecenie: 'polecenie dla systemu zamiast tezy',
  dane_osobowe: 'dane osobowe osoby prywatnej',
};

const PROMPT = require('../../config/prompty/filtrWstepny');

function regulyWstepne(tekst) {
  const t = String(tekst || '').trim();
  const litery = (t.match(/\p{L}/gu) || []).length;
  if (litery < 8) return { kategoria: 'brak_tezy', powod: 'Tekst jest za krótki, żeby zawierał tezę do sprawdzenia.' };
  if (litery / Math.max(1, t.length) < 0.4) return { kategoria: 'belkot', powod: 'Tekst składa się głównie ze znaków innych niż litery.' };
  if (/(.)\1{7,}/u.test(t)) return { kategoria: 'belkot', powod: 'Tekst zawiera długie powtórzenia tych samych znaków.' };
  const slowa = t.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 1);
  if (slowa.length >= 6 && new Set(slowa).size / slowa.length < 0.3) {
    return { kategoria: 'belkot', powod: 'Tekst powtarza w kółko te same słowa.' };
  }
  return null;
}

/**
 * @param {string} tekst - tekst po Modelu 1 (z OCR i stronami)
 * @param {object} [options] - { useLlm, ollamaUrl, model, timeoutMs, fetchImpl }
 * @returns {Promise<{przepuscic: boolean, kategoria: string, opis: string, powod: string, metoda: string}>}
 */
async function filtrujZgloszenie(tekst, options = {}) {
  const reguly = regulyWstepne(tekst);
  if (reguly) return { przepuscic: false, ...reguly, opis: KATEGORIE[reguly.kategoria], metoda: 'reguly' };

  const przepusc = (metoda, powod = '') => ({ przepuscic: true, kategoria: 'teza', opis: KATEGORIE.teza, powod, metoda });
  if (options.useLlm === false || process.env.KOMA_FILTR_WSTEPNY === '0') return przepusc('pominiety');

  const baseUrl = String(options.ollamaUrl || OLLAMA_URL).replace(/\/api\/(generate|chat)\/?$/i, '').replace(/\/+$/, '');
  const fetchFn = options.fetchImpl || fetch;
  try {
    const odp = await fetchFn(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs || ZADANIA.filtrWstepny.timeoutMs),
      body: JSON.stringify({
        model: options.model || ZADANIA.filtrWstepny.model,
        stream: false,
        think: false,
        format: 'json',
        options: { temperature: 0, num_ctx: ZADANIA.filtrWstepny.numCtx, num_predict: ZADANIA.filtrWstepny.numPredict },
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: `<TEKST_UZYTKOWNIKA>\n${String(tekst).slice(0, 6000)}\n</TEKST_UZYTKOWNIKA>` },
        ],
      }),
    });
    if (!odp.ok) return przepusc('blad_modelu');
    const dane = await odp.json();
    const p = JSON.parse(dane?.message?.content ?? dane?.response);
    const kategoria = KATEGORIE[p?.kategoria] ? p.kategoria : 'teza';
    const powod = typeof p?.powod === 'string' ? p.powod.trim() : '';
    if (kategoria === 'teza') return przepusc('model', powod);
    return { przepuscic: false, kategoria, opis: KATEGORIE[kategoria], powod, metoda: 'model' };
  } catch {
    return przepusc('blad_modelu');
  }
}

module.exports = { filtrujZgloszenie, regulyWstepne, KATEGORIE };
