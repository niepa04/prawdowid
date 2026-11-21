import { useRef, useState } from 'react';
import Ikona from './Ikona.jsx';

const WZOR_LINKU = /https?:\/\/[^\s<>"'`()[\]{}]+/gi;

function znajdzLinki(tekst) {
  const linki = (tekst.match(WZOR_LINKU) || []).map((l) => l.replace(/[.,;:!?]+$/, ''));
  return [...new Set(linki)];
}

function skrocLink(link) {
  const bez = link.replace(/^https?:\/\/(www\.)?/, '');
  return bez.length > 32 ? bez.slice(0, 30) + '…' : bez;
}

function jakoBase64(plik) {
  return new Promise((ok, blad) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => blad(r.error);
    r.readAsDataURL(plik);
  });
}

// Identyfikator bez crypto.randomUUID(), które działa tylko na localhost/https
// (przez adres Tailscale http://100.x.x.x go nie ma i wklejanie przestawało działać)
let licznikId = 0;
const noweId = () => `zdj-${Date.now()}-${++licznikId}`;

// Duże zrzuty ekranu zmniejszamy w przeglądarce: serwer przyjmuje do 5 MB na zdjęcie,
// a OCR i tak nie potrzebuje więcej niż ~2000 px na dłuższym boku.
const MAX_BOK = 2000;
const MAX_BAJTOW = 1.5 * 1024 * 1024;
async function przygotujZdjecie(plik) {
  const dataUrl = await jakoBase64(plik);
  const img = await new Promise((ok, blad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => blad(new Error('Nie udało się odczytać obrazu.'));
    i.src = dataUrl;
  });
  const skala = Math.min(1, MAX_BOK / Math.max(img.width, img.height));
  if (skala === 1 && plik.size <= MAX_BAJTOW) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * skala);
  canvas.height = Math.round(img.height * skala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // przezroczyste tło PNG -> białe, żeby tekst był czytelny dla OCR
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

// Obrazy ze schowka: najpierw clipboardData.files, a gdy puste - clipboardData.items
// (niektóre programy wkładają obraz tylko jako element schowka)
function obrazyZeSchowka(dane) {
  const pliki = [...(dane.files || [])].filter((p) => p.type.startsWith('image/'));
  if (pliki.length) return pliki;
  return [...(dane.items || [])]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter(Boolean);
}

// Jedno pole na wszystko: tekst, wklejone linki i zdjęcia (Ctrl+V albo z dysku).
// Linki są wykrywane w tekście i pokazywane jako kafelki pod polem.
export default function PoleWejscia({ onSprawdz }) {
  const [tekst, setTekst] = useState('');
  const [zdjecia, setZdjecia] = useState([]); // { id, nazwa, dataUrl }
  const [blad, setBlad] = useState('');
  const [przeciaganie, setPrzeciaganie] = useState(false);
  const wyborPliku = useRef(null);

  const linki = znajdzLinki(tekst);

  async function dodajZdjecia(pliki) {
    const obrazy = [...pliki].filter((p) => p.type.startsWith('image/'));
    if (!obrazy.length) return;
    try {
      const nowe = await Promise.all(
        obrazy.map(async (p) => ({ id: noweId(), nazwa: p.name || 'wklejone zdjęcie', dataUrl: await przygotujZdjecie(p) }))
      );
      setZdjecia((z) => [...z, ...nowe].slice(0, 10)); // serwer przyjmuje do 10 zdjęć
      setBlad('');
    } catch (err) {
      setBlad(`Nie udało się dodać zdjęcia: ${err.message}`);
    }
  }

  function wklej(e) {
    const pliki = obrazyZeSchowka(e.clipboardData);
    if (pliki.length) {
      e.preventDefault();
      dodajZdjecia(pliki);
      return;
    }
    // Obraz skopiowany razem z fragmentem strony trafia do schowka tylko jako link w HTML
    const html = e.clipboardData.getData('text/html');
    if (/<img\b/i.test(html) && !e.clipboardData.getData('text/plain').trim()) {
      e.preventDefault();
      setBlad('Ten obraz wkleił się jako link, nie jako plik. Kliknij go prawym przyciskiem i wybierz „Kopiuj obraz” albo zapisz go i użyj „Dodaj zdjęcie”.');
    }
  }

  function usunLink(link) {
    setTekst((t) => t.split(link).join('').replace(/[ \t]{2,}/g, ' '));
  }

  function wyslij() {
    if (!tekst.trim() && !zdjecia.length) {
      setBlad('Wpisz albo wklej informację, którą chcesz sprawdzić.');
      return;
    }
    onSprawdz({ tekst, linki, zdjecia });
  }

  const podsumowanie = [
    tekst.trim() && 'tekst',
    linki.length && `${linki.length} ${linki.length === 1 ? 'link' : 'linki'}`,
    zdjecia.length && `${zdjecia.length} ${zdjecia.length === 1 ? 'zdjęcie' : 'zdjęcia'}`,
  ].filter(Boolean);

  return (
    <div className="wejscie">
      <div
        className={`pole ${przeciaganie ? 'pole--przeciaganie' : ''} ${blad ? 'pole--blad' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setPrzeciaganie(true); }}
        onDragLeave={() => setPrzeciaganie(false)}
        onDrop={(e) => { e.preventDefault(); setPrzeciaganie(false); dodajZdjecia(e.dataTransfer.files); }}
      >
        <textarea
          className="pole__tekst"
          placeholder="Wklej informację do sprawdzenia: tekst, link albo zrzut ekranu"
          value={tekst}
          onChange={(e) => { setTekst(e.target.value); setBlad(''); }}
          onPaste={wklej}
          rows={4}
        />

        {(linki.length > 0 || zdjecia.length > 0) && (
          <div className="kafelki">
            {linki.map((link) => (
              <span key={link} className="kafelek kafelek--link" title={link}>
                <Ikona nazwa="link" rozmiar={14} />
                {skrocLink(link)}
                <button className="kafelek__usun" onClick={() => usunLink(link)} aria-label={`Usuń link ${link}`}>
                  <Ikona nazwa="x" rozmiar={12} />
                </button>
              </span>
            ))}
            {zdjecia.map((z) => (
              <span key={z.id} className="kafelek kafelek--zdjecie" title={z.nazwa}>
                <img src={z.dataUrl} alt="" className="kafelek__miniatura" />
                {z.nazwa.length > 20 ? z.nazwa.slice(0, 18) + '…' : z.nazwa}
                <button
                  className="kafelek__usun"
                  onClick={() => setZdjecia((lista) => lista.filter((x) => x.id !== z.id))}
                  aria-label={`Usuń zdjęcie ${z.nazwa}`}
                >
                  <Ikona nazwa="x" rozmiar={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="pole__dol">
          <button className="przycisk-maly" onClick={() => wyborPliku.current.click()}>
            <Ikona nazwa="zdjecie" rozmiar={16} />
            Dodaj zdjęcie
          </button>
          <span className="pole__podpowiedz">albo wklej Ctrl+V, przeciągnij plik</span>
          {podsumowanie.length > 0 && <span className="pole__licznik">{podsumowanie.join(' · ')}</span>}
          <input
            ref={wyborPliku}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => { dodajZdjecia(e.target.files); e.target.value = ''; }}
          />
        </div>
      </div>

      {blad && <p className="blad">{blad}</p>}

      <button className="przycisk-glowny" onClick={wyslij}>
        Sprawdź prawdziwość
      </button>

      <ul className="zalety">
        <li><Ikona nazwa="check" rozmiar={16} />Teksty, linki i zrzuty ekranu</li>
        <li><Ikona nazwa="check" rozmiar={16} />Porównanie z bazą Demagoga</li>
        <li><Ikona nazwa="check" rozmiar={16} />Wynik w kilkanaście sekund</li>
      </ul>
    </div>
  );
}
