// wynik.js - okno wyniku: wysyła zaznaczony tekst do serwera Koma (/api/weryfikuj) i pokazuje werdykt.
// Treść z serwera (cytaty, uzasadnienia, tytuły źródeł) wstawiamy wyłącznie przez textContent,
// a linki tylko http(s) - strona, z której pochodzi tekst, nie może niczego wstrzyknąć.

const KLASY = {
  Potwierdzone: 'prawda',
  'Wprowadzające w błąd': 'manipulacja',
  Fałszywe: 'falsz',
  'Brak wystarczających dowodów': 'brak',
  'Nie podlega weryfikacji': 'brak',
  'Nie można teraz sprawdzić': 'niedostepne',
  'Zablokowano: dane osobowe': 'zablokowane',
};
const OPISY = {
  'Zablokowano: dane osobowe': 'Nie można używać danych osobowych w zapytaniach.',
  Potwierdzone: 'Sprawdzone źródła potwierdzają tę informację.',
  'Wprowadzające w błąd': 'Informacja zawiera prawdziwe elementy, ale przekręca fakty albo pomija ważny kontekst.',
  Fałszywe: 'Sprawdzone źródła i fact-checkerzy zaprzeczają tej informacji.',
  'Brak wystarczających dowodów': 'Nie znaleźliśmy dość materiałów, żeby to rozstrzygnąć. To nie znaczy, że informacja jest fałszywa.',
  'Nie podlega weryfikacji': 'To opinia, ocena albo pytanie, a nie fakt, który da się sprawdzić.',
  'Nie można teraz sprawdzić': 'Wyszukiwarka źródeł jest teraz niedostępna. To nie znaczy, że nie ma na ten temat informacji.',
};

const $ = (id) => document.getElementById(id);

function el(tag, klasa, tekst) {
  const e = document.createElement(tag);
  if (klasa) e.className = klasa;
  if (tekst != null) e.textContent = tekst;
  return e;
}

function pokaz(sekcja) {
  for (const id of ['ladowanie', 'blad', 'wynik', 'zgoda']) $(id).hidden = id !== sekcja;
}

// ---- Zdjęcia ----
// OCR na serwerze czyta tylko PNG/JPEG do 5 MB, więc każde zdjęcie (WebP, AVIF, GIF, SVG...)
// przerabiamy w oknie na JPEG z dłuższym bokiem do 2000 px.
const MAX_BOK = 2000;

class BrakZgody extends Error {
  constructor(origin) {
    super(`Brak zgody na pobieranie z ${origin}`);
    this.origin = origin;
  }
}

async function pobierzZdjecie(url) {
  if (/^data:image\//i.test(url)) return (await fetch(url)).blob();
  const { origin } = new URL(url);
  let odp;
  try {
    odp = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(20000) });
  } catch {
    // Najczęściej CORS: serwer zdjęcia nie pozwala go pobrać innym stronom.
    // Z uprawnieniem do tej domeny rozszerzenie może je pobrać - pytamy użytkownika.
    if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) throw new BrakZgody(origin);
    throw new Error(`Nie udało się pobrać zdjęcia z ${new URL(url).host}.`);
  }
  if (!odp.ok) throw new Error(`Serwer zdjęcia zwrócił błąd ${odp.status}.`);
  const blob = await odp.blob();
  if (blob.size > 25 * 1024 * 1024) throw new Error('Zdjęcie jest za duże (ponad 25 MB).');
  return blob;
}

async function naJpeg(blob) {
  const adres = URL.createObjectURL(blob);
  try {
    const img = await new Promise((ok, blad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => blad(new Error('To nie jest obraz, który da się odczytać.'));
      i.src = adres;
    });
    const skala = Math.min(1, MAX_BOK / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || 800) * skala));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 600) * skala));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // przezroczyste tło -> białe, żeby tekst był czytelny dla OCR
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(adres);
  }
}

function pokazZgode(origin, zgloszenie) {
  $('zgoda-host').textContent = new URL(origin).host;
  $('zgoda-przycisk').onclick = async () => {
    // Zgoda musi być wywołana bezpośrednio po kliknięciu (wymóg przeglądarki)
    const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (ok) sprawdz(zgloszenie);
    else pokazBlad('Bez zgody rozszerzenie nie może pobrać tego zdjęcia. Możesz je zapisać na dysku i wkleić na stronie Koma.');
  };
  pokaz('zgoda');
}

function listaZrodel(zrodla) {
  const ul = el('ul', 'zrodla');
  for (const z of zrodla.slice(0, 4)) {
    const li = el('li', 'zrodlo');
    const url = bezpiecznyUrl(z.url);
    const tytul = z.title || z.publisher || z.url || 'Źródło';
    if (url) {
      const a = el('a', 'zrodlo__tytul', tytul);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      li.append(a);
    } else {
      li.append(el('span', 'zrodlo__tytul', tytul));
    }
    // Wydawca, data publikacji i znacznik starszego materiału (jak na stronie)
    const data = formatujDate(z.published_at);
    const meta = [z.title ? z.publisher : null, data].filter(Boolean).join(' · ');
    if (meta || czyArchiwalna(z.published_at)) {
      const m = el('div', 'zrodlo__meta', meta);
      if (czyArchiwalna(z.published_at)) m.append(el('span', 'zrodlo__archiwum', 'Starszy materiał'));
      li.append(m);
    }
    ul.append(li);
  }
  return ul;
}

function formatujDate(wartosc) {
  if (!wartosc) return null;
  const d = new Date(wartosc);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function czyArchiwalna(wartosc, progDni = 365) {
  if (!wartosc) return false;
  const d = new Date(wartosc);
  return !Number.isNaN(d.getTime()) && Date.now() - d.getTime() > progDni * 24 * 60 * 60 * 1000;
}

// Siła podstawy odpowiedzi - te same progi i opisy co na stronie (front-end/src/werdykty.js)
function silaPodstawy(poziom, metoda) {
  if (poziom === 'wysoka') {
    return { klasa: 'wysoka', etykieta: 'Podstawa odpowiedzi: wysoka', opis: metoda === 'ocena_fact_checkera' ? 'Oparte na ocenie niezależnych fact-checkerów.' : 'Jednoznaczne potwierdzenie w źródłach.' };
  }
  if (poziom === 'umiarkowana') return { klasa: 'umiarkowana', etykieta: 'Podstawa odpowiedzi: umiarkowana', opis: 'Ustalono na podstawie zebranych materiałów źródłowych.' };
  if (poziom === 'niska') return { klasa: 'niska', etykieta: 'Podstawa odpowiedzi: niska', opis: 'Niewystarczające lub niejednoznaczne materiały.' };
  return null;
}

function blokSily(poziom, metoda, zwarta = false) {
  const info = silaPodstawy(poziom, metoda);
  if (!info) return null;
  const blok = el('div', `sila sila--${info.klasa}${zwarta ? ' sila--zwarta' : ''}`);
  blok.append(el('strong', null, info.etykieta));
  if (!zwarta) blok.append(el('span', null, info.opis));
  return blok;
}

const OPISY_FLAG = {
  prompt_injection_detected: 'W treści jednego ze źródeł wykryto próbę manipulacji instrukcjami — została zignorowana.',
  input_command_only: 'Zgłoszenie zawierało wyłącznie polecenie dla systemu zamiast informacji do sprawdzenia.',
  personal_data: 'Zgłoszenie zawierało dane osobowe – ze względu na ochronę prywatności nie zostało przekazane dalej.',
  redirect_blocked: 'Zablokowano przekierowanie poza zatwierdzoną listę źródeł.',
  search_result_untrusted_host: 'Pominięto niezweryfikowany adres spoza zatwierdzonej listy źródeł.',
};

function listaFlag(flagi) {
  if (!Array.isArray(flagi) || !flagi.length) return null;
  const opisy = [...new Set(flagi.map((f) => OPISY_FLAG[f?.type] || 'Wykryto i zablokowano potencjalną próbę manipulacji treścią.'))];
  const ul = el('ul', 'alert-bezpieczenstwa');
  for (const o of opisy) ul.append(el('li', null, o));
  return ul;
}

function kartaTezy(t, numer) {
  const klasa = KLASY[t.werdykt] || 'brak';
  const karta = el('article', `teza teza--${klasa}`);
  const gora = el('div', 'teza__gora');
  gora.append(el('span', 'teza__numer', String(numer)), el('p', 'teza__tresc', `„${t.claim}”`));
  karta.append(gora, el('div', `teza__werdykt werdykt--${klasa}`, t.werdykt));
  const sila = blokSily(t.sila_dowodow, t.metoda, true);
  if (sila) karta.append(sila);
  if (t.uzasadnienie) karta.append(el('p', 'teza__uzasadnienie', t.uzasadnienie));
  if (Array.isArray(t.uzyte_zrodla) && t.uzyte_zrodla.length) karta.append(listaZrodel(t.uzyte_zrodla.slice(0, 3)));
  return karta;
}

function stopkaWyniku(w, serwer) {
  const stopka = el('div', 'stopka');
  stopka.append(el('span', null, w.metadane?.czas_calkowity_ms != null ? `Sprawdzono w ${Math.round(w.metadane.czas_calkowity_ms / 1000)} s` : ''));
  // Strona Koma serwowana przez Express (ten sam adres co API)
  const pelny = el('a', 'przycisk przycisk--drugi', 'Otwórz Koma w przeglądarce');
  pelny.href = `${serwer}/`;
  pelny.target = '_blank';
  pelny.rel = 'noreferrer noopener';
  stopka.append(pelny);
  return stopka;
}

function pokazWynik(w, serwer) {
  const dem = w.demagog || {};
  const nazwa = dem.werdykt_ogolny || w.werdykt_ogolny || 'Brak wystarczających dowodów';
  const tezy = Array.isArray(dem.twierdzenia) ? dem.twierdzenia : [];
  const sekcja = $('wynik');
  sekcja.replaceChildren();

  // Odrzucenie przez filtr (dane osobowe, brak tezy, samo polecenie) to nie werdykt merytoryczny
  const odrzucone = w.status === 'rejected' || Boolean(w.metadane?.odrzucone_przez_filtr);
  if (odrzucone) {
    const daneOsobowe = Boolean(w.metadane?.dane_osobowe);
    const komunikat = el('div', `komunikat${daneOsobowe ? ' komunikat--zablokowane' : ''}`);
    komunikat.setAttribute('role', 'status');
    komunikat.append(
      el('div', 'etykieta', daneOsobowe ? 'Ochrona prywatności' : 'Wymaga doprecyzowania'),
      el('div', 'komunikat__tytul', daneOsobowe ? 'Zablokowano: dane osobowe' : 'Nie znaleziono tezy do weryfikacji'),
      el('p', 'komunikat__opis', dem.glowna_odpowiedz || '')
    );
    sekcja.append(komunikat);
    const flagi = listaFlag(w.metadane?.security_flags);
    if (flagi) sekcja.append(flagi);
    sekcja.append(stopkaWyniku(w, serwer));
    pokaz('wynik');
    return;
  }

  // Link prowadzi do zaufanego źródła: informacja, ale werdykt opiera się na INNYCH stronach
  if (w.zrodlo_zgloszenia?.zaufane?.length) {
    const ramka = el('div', 'zrodlo-zgloszenia');
    ramka.setAttribute('role', 'note');
    ramka.append(el('div', 'zrodlo-zgloszenia__tytul', '✓ Zweryfikowane źródło'), el('p', 'zrodlo-zgloszenia__opis', w.zrodlo_zgloszenia.komunikat || ''));
    sekcja.append(ramka);
  }

  const werdykt = el('div', `werdykt werdykt--${KLASY[nazwa] || 'brak'}`);
  werdykt.append(el('div', 'etykieta', tezy.length > 1 ? 'Werdykt ogólny' : 'Werdykt'), el('div', 'werdykt__nazwa', nazwa), el('p', 'werdykt__opis', OPISY[nazwa] || ''));
  sekcja.append(werdykt);

  if (tezy.length > 1) {
    sekcja.append(el('h2', 'podtytul', `Sprawdziliśmy ${tezy.length} ${tezy.length < 5 ? 'wątki' : 'wątków'}`));
    tezy.forEach((t, i) => sekcja.append(kartaTezy(t, i + 1)));
  } else {
    const t = tezy[0];
    const sila = t && blokSily(t.sila_dowodow, t.metoda);
    if (sila) sekcja.append(sila);
    const wyjasnienie = t?.uzasadnienie || dem.glowna_odpowiedz;
    if (wyjasnienie) sekcja.append(el('p', 'wyjasnienie', wyjasnienie));
    const zrodla = t?.uzyte_zrodla?.length ? t.uzyte_zrodla : dem.glowne_zrodla || [];
    if (zrodla.length) {
      sekcja.append(el('h2', 'podtytul', 'Źródła'), listaZrodel(zrodla));
    }
  }

  const ostrzezenia = w.metadane?.ostrzezenia || [];
  if (ostrzezenia.length) {
    const ul = el('ul', 'ostrzezenia');
    for (const o of ostrzezenia.slice(0, 3)) ul.append(el('li', null, o));
    sekcja.append(ul);
  }
  const flagi = listaFlag(w.metadane?.security_flags);
  if (flagi) sekcja.append(flagi);

  sekcja.append(stopkaWyniku(w, serwer));
  pokaz('wynik');
}

function pokazBlad(tresc) {
  $('blad-tresc').textContent = tresc;
  pokaz('blad');
}

let licznik;
async function sprawdz(zgloszenie) {
  pokaz('ladowanie');
  const start = Date.now();
  clearInterval(licznik);
  licznik = setInterval(() => ($('sekundy').textContent = String(Math.round((Date.now() - start) / 1000))), 1000);

  const serwer = await adresSerwera();
  try {
    let cialo = { tekst: zgloszenie.tekst };
    if (zgloszenie.zdjecieUrl) {
      $('ladowanie-tekst').textContent = 'Pobieramy zdjęcie…';
      try {
        const jpeg = zgloszenie.jpeg || (zgloszenie.jpeg = await naJpeg(await pobierzZdjecie(zgloszenie.zdjecieUrl)));
        $('podglad').src = jpeg;
        cialo = { tekst: '', zdjecia: [jpeg] };
      } catch (err) {
        if (err instanceof BrakZgody) return pokazZgode(err.origin, zgloszenie);
        return pokazBlad(`${err.message} Możesz zapisać zdjęcie na dysku i wkleić je na stronie Koma.`);
      }
      $('ladowanie-tekst').textContent = 'Odczytujemy tekst ze zdjęcia i sprawdzamy źródła…';
    }
    let odp;
    try {
      odp = await fetch(`${serwer}/api/weryfikuj`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cialo),
      });
    } catch {
      pokazBlad(`Nie można połączyć się z serwerem Koma (${serwer}). Sprawdź, czy serwer działa i czy adres w ustawieniach jest poprawny.`);
      return;
    }
    let dane = null;
    try {
      dane = await odp.json();
    } catch {
      // odpowiedź bez JSON-a
    }
    if (!odp.ok) {
      pokazBlad(dane?.blad || `Serwer zwrócił błąd ${odp.status}.`);
      return;
    }
    pokazWynik(dane, serwer);
  } finally {
    clearInterval(licznik);
  }
}

(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const klucz = `zgloszenie-${id}`;
  const zgloszenie = (await chrome.storage.session.get(klucz))[klucz];
  // Bez poprawnego zgłoszenia nie ma czego ponawiać - zostaje tylko przycisk ustawień
  $('ponow').hidden = !(zgloszenie?.tekst || zgloszenie?.zdjecieUrl);
  $('ustawienia').addEventListener('click', () => chrome.runtime.openOptionsPage());
  if (zgloszenie?.bladZdjecia) {
    $('etykieta-zgloszenia').textContent = 'Twoje zgłoszenie (zdjęcie)';
    $('tekst').textContent = '—';
    pokazBlad('Tego zdjęcia nie da się pobrać (jest osadzone w stronie w specjalny sposób). Zapisz je na dysku i wklej na stronie Koma.');
    return;
  }
  if (!zgloszenie?.tekst && !zgloszenie?.zdjecieUrl) {
    $('tekst').textContent = '—';
    pokazBlad('Nie znaleziono zaznaczonego tekstu. Zaznacz tekst na stronie i wybierz „Sprawdź w Koma” z menu pod prawym przyciskiem.');
    return;
  }
  if (zgloszenie.zdjecieUrl) {
    $('etykieta-zgloszenia').textContent = 'Twoje zgłoszenie (zdjęcie)';
    $('tekst').hidden = true;
    $('podglad').hidden = false;
    // Podgląd tylko z adresu http(s)/data:image - po pobraniu podmieniany na przetworzony JPEG
    if (bezpiecznyUrl(zgloszenie.zdjecieUrl) || /^data:image\//i.test(zgloszenie.zdjecieUrl)) $('podglad').src = zgloszenie.zdjecieUrl;
  } else {
    $('tekst').textContent = zgloszenie.tekst;
  }
  $('przyciety').hidden = !zgloszenie.przyciety;
  $('ponow').addEventListener('click', () => sprawdz(zgloszenie));
  sprawdz(zgloszenie);
})();
