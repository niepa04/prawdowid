// wspolne.js - ustawienia wspólne dla okna wyniku i strony ustawień

const DOMYSLNY_SERWER = 'http://localhost:3000';

async function adresSerwera() {
  const { serwer } = await chrome.storage.sync.get('serwer');
  return (serwer || DOMYSLNY_SERWER).replace(/\/+$/, '');
}

// Tylko http(s) - do href i do zapytań
function bezpiecznyUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
