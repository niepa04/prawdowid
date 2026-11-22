// background.js - pozycje w menu pod prawym przyciskiem:
//   "Weryfikuj w Koma: …"      - przy zaznaczonym tekście
//   "Weryfikuj zdjęcie w Koma" - na obrazku
// Po kliknięciu zgłoszenie trafia do chrome.storage.session, a wynik pokazuje osobne okno
// (wynik.html), które samo pobiera zdjęcie i wysyła zapytanie do serwera Koma. Rozszerzenie nie
// czyta stron i nie wstrzykuje do nich skryptów - dostaje tylko to, co użytkownik sam wskazał.

const MENU_TEKST = 'koma-sprawdz';
const MENU_ZDJECIE = 'koma-zdjecie';
const MAX_ZNAKOW = 10000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_TEKST, title: 'Weryfikuj w Koma: „%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_ZDJECIE, title: 'Weryfikuj zdjęcie w Koma', contexts: ['image'] });
  });
});

function zgloszenieZKlikniecia(info) {
  if (info.menuItemId === MENU_TEKST) {
    const tekst = String(info.selectionText || '').trim();
    return tekst ? { tekst: tekst.slice(0, MAX_ZNAKOW), przyciety: tekst.length > MAX_ZNAKOW } : null;
  }
  if (info.menuItemId === MENU_ZDJECIE) {
    const url = String(info.srcUrl || '');
    return /^(https?:|data:image\/)/i.test(url) ? { zdjecieUrl: url } : { bladZdjecia: true };
  }
  return null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const zgloszenie = zgloszenieZKlikniecia(info);
  if (!zgloszenie) return;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await chrome.storage.session.set({
    [`zgloszenie-${id}`]: { ...zgloszenie, strona: tab?.url && /^https?:/.test(tab.url) ? tab.url : null },
  });

  await chrome.windows.create({
    url: chrome.runtime.getURL(`wynik.html?id=${encodeURIComponent(id)}`),
    type: 'popup',
    width: 520,
    height: 720,
  });
});

// Kliknięcie ikony rozszerzenia otwiera ustawienia (adres serwera)
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
