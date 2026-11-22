// ustawienia.js - adres serwera Koma. Dla adresu innego niż localhost:3000 rozszerzenie prosi
// przeglądarkę o zgodę na połączenie tylko z tym jednym adresem (optional_host_permissions).

const pole = document.getElementById('serwer');
const komunikat = document.getElementById('komunikat');

function napisz(tekst, blad = false) {
  komunikat.textContent = tekst;
  komunikat.classList.toggle('status--blad', blad);
}

function normalizuj(surowy) {
  const url = bezpiecznyUrl(String(surowy || '').trim() || DOMYSLNY_SERWER);
  if (!url) return null;
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

async function zgoda(adres) {
  const wzor = `${adres}/*`;
  if (await chrome.permissions.contains({ origins: [wzor] })) return true;
  return chrome.permissions.request({ origins: [wzor] });
}

document.getElementById('zapisz').addEventListener('click', async () => {
  const adres = normalizuj(pole.value);
  if (!adres) return napisz('Podaj adres zaczynający się od http:// albo https://', true);
  // Zgoda musi być wywołana bezpośrednio po kliknięciu (wymóg przeglądarki)
  if (!(await zgoda(adres))) return napisz('Bez zgody przeglądarki rozszerzenie nie połączy się z tym adresem.', true);
  await chrome.storage.sync.set({ serwer: adres });
  pole.value = adres;
  napisz('Zapisano.');
});

document.getElementById('testuj').addEventListener('click', async () => {
  const adres = normalizuj(pole.value);
  if (!adres) return napisz('Podaj poprawny adres.', true);
  if (!(await zgoda(adres))) return napisz('Brak zgody na połączenie z tym adresem.', true);
  napisz('Łączenie…');
  try {
    const odp = await fetch(`${adres}/api/status`, { signal: AbortSignal.timeout(8000) });
    napisz(odp.ok ? 'Połączono z serwerem Koma.' : `Serwer odpowiedział błędem ${odp.status}.`, !odp.ok);
  } catch {
    napisz(`Nie można połączyć się z ${adres}. Czy serwer Koma działa?`, true);
  }
});

adresSerwera().then((a) => (pole.value = a));
