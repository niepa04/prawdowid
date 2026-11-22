const KLUCZ_HISTORII = 'koma_historia_v1';
const MAX_WPISOW = 8;

function zapiszSurowe(lista) {
  try {
    localStorage.setItem(KLUCZ_HISTORII, JSON.stringify(lista));
  } catch {
    // tryb prywatny albo brak miejsca w localStorage
  }
}

export function wczytajHistorie() {
  try {
    const raw = localStorage.getItem(KLUCZ_HISTORII);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function zapiszWHistorii({ zgloszenie, wynik }) {
  if (!wynik || wynik.status === 'unavailable' || wynik.metadane?.niedostepne) return wczytajHistorie();
  const wpis = {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    czasIso: new Date().toISOString(),
    tekst: (zgloszenie?.tekst || wynik.tekst || '').trim(),
    liczbaZdjec: (zgloszenie?.zdjecia || []).length,
    werdykt: wynik.status === 'rejected' || wynik.metadane?.odrzucone_przez_filtr
      ? 'Wymaga doprecyzowania'
      : (wynik.demagog?.werdykt_ogolny || wynik.werdykt_ogolny || 'Brak wystarczających dowodów'),
    wynik,
  };
  const obecna = wczytajHistorie().filter((x) => !(x.tekst === wpis.tekst && x.werdykt === wpis.werdykt));
  const nowa = [wpis, ...obecna].slice(0, MAX_WPISOW);
  zapiszSurowe(nowa);
  return nowa;
}

export function usunZHistorii(id) {
  const nowa = wczytajHistorie().filter((x) => x.id !== id);
  zapiszSurowe(nowa);
  return nowa;
}

export function wyczyscHistorie() {
  try {
    localStorage.removeItem(KLUCZ_HISTORII);
  } catch {
    // pomijamy
  }
  return [];
}
