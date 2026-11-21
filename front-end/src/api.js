// api.js - komunikacja z backendem (app/koma.js). W trybie dev Vite przekierowuje /api na port 3000.

export class BladApi extends Error {
  constructor(wiadomosc, status) {
    super(wiadomosc);
    this.status = status;
  }
}

// zgloszenie: { tekst, zdjecia: [{ dataUrl }] } -> pełny wynik pipeline'u
// Linki zostają w tekście, backend sam je wyciąga.
export async function weryfikuj({ tekst, zdjecia }) {
  let odp;
  try {
    odp = await fetch('/api/weryfikuj', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tekst, zdjecia: zdjecia.map((z) => z.dataUrl) }),
    });
  } catch {
    throw new BladApi('Nie udało się połączyć z serwerem. Sprawdź, czy backend działa.', 0);
  }

  let dane = null;
  try {
    dane = await odp.json();
  } catch {
    // odpowiedź bez JSON-a, np. błąd proxy
  }
  if (!odp.ok) {
    throw new BladApi(dane?.blad || `Serwer zwrócił błąd ${odp.status}.`, odp.status);
  }
  return dane;
}

// Tylko linki http(s) mogą trafić do href (ochrona przed javascript: itp.)
export function bezpiecznyUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
