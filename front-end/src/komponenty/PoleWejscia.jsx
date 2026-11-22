import { useRef, useState } from 'react';
import Ikona from './Ikona.jsx';
import PodgladObrazu from './PodgladObrazu.jsx';
import { odmiana } from '../odmiana.js';

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
  // Model OCR czyta tylko PNG i JPEG - WebP, AVIF, GIF, BMP, HEIC itp. zawsze przerabiamy na JPEG
  const formatOcr = /^data:image\/(png|jpe?g);/i.test(dataUrl);
  if (formatOcr && skala === 1 && plik.size <= MAX_BAJTOW) return dataUrl;

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

const MAX_ZNAKOW = 50000;
const PRZYKLADY = [
  { etykieta: 'Prezydent Polski', tekst: 'Karol Nawrocki jest prezydentem Polski.' },
  { etykieta: 'Strajk we Włoszech', tekst: 'We Włoszech zapowiedziano strajk generalny.' },
  { etykieta: 'Środki z PPK', tekst: 'Rząd planuje wykorzystać pieniądze zgromadzone w PPK do finansowania inwestycji publicznych.' },
];

// Jedno pole na wszystko: tekst, wklejone linki i zdjęcia (Ctrl+V albo z dysku).
// Linki są wykrywane w tekście i pokrywane jako kafelki pod polem.
export default function PoleWejscia({ poczatkowe, onSprawdz }) {
  const [tekst, setTekst] = useState(poczatkowe?.tekst || '');
  const [zdjecia, setZdjecia] = useState(poczatkowe?.zdjecia || []); // { id, nazwa, dataUrl }
  const [blad, setBlad] = useState('');
  const [przeciaganie, setPrzeciaganie] = useState(false);
  const [podgladZdjecia, setPodgladZdjecia] = useState(null);
  const wyborPliku = useRef(null);
  const poleTekstu = useRef(null);

  const linki = znajdzLinki(tekst);
  const zaDlugiTekst = tekst.length > MAX_ZNAKOW;

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

  async function wklejPrzyciskiem() {
    if (!navigator.clipboard) return;
    try {
      if (navigator.clipboard.read) {
        const pozycje = await navigator.clipboard.read();
        const obrazy = [];
        let wklejonyTekst = '';
        for (const poz of pozycje) {
          const typObrazu = poz.types.find((t) => t.startsWith('image/'));
          if (typObrazu) {
            const blob = await poz.getType(typObrazu);
            obrazy.push(new File([blob], 'ze-schowka.png', { type: typObrazu }));
          } else if (poz.types.includes('text/plain')) {
            const blob = await poz.getType('text/plain');
            wklejonyTekst += await blob.text();
          }
        }
        if (obrazy.length) await dodajZdjecia(obrazy);
        if (wklejonyTekst) {
          setTekst((t) => (t.trim() ? `${t}\n${wklejonyTekst}` : wklejonyTekst));
          setBlad('');
        }
        return;
      }
      if (navigator.clipboard.readText) {
        const t = await navigator.clipboard.readText();
        if (t) {
          setTekst((prev) => (prev.trim() ? `${prev}\n${t}` : t));
          setBlad('');
        }
      }
    } catch {
      setBlad('Przeglądarka nie pozwoliła odczytać schowka – wklej ręcznie (Ctrl+V).');
    }
  }

  function wyslij() {
    if (!tekst.trim() && !zdjecia.length) {
      setBlad('Wpisz albo wklej informację, którą chcesz sprawdzić.');
      return;
    }
    if (zaDlugiTekst) {
      setBlad(`Tekst ma ponad ${MAX_ZNAKOW.toLocaleString('pl-PL')} znaków. Skróć go przed wysłaniem.`);
      return;
    }
    onSprawdz({ tekst, linki, zdjecia });
  }

  const podsumowanie = [
    tekst.trim() && 'tekst',
    linki.length && `${linki.length} ${odmiana(linki.length, 'link', 'linki', 'linków')}`,
    zdjecia.length && `${zdjecia.length} ${odmiana(zdjecia.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}`,
  ].filter(Boolean);

  function obsluzKlawisz(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      wyslij();
    }
  }

  return (
    <div className="wejscie">
      <div
        className={`pole ${przeciaganie ? 'pole--przeciaganie' : ''} ${blad ? 'pole--blad' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setPrzeciaganie(true); }}
        onDragLeave={() => setPrzeciaganie(false)}
        onDrop={(e) => { e.preventDefault(); setPrzeciaganie(false); dodajZdjecia(e.dataTransfer.files); }}
      >
        <textarea
          ref={poleTekstu}
          className="pole__tekst"
          placeholder="Wpisz lub wklej tekst, link albo zrzut ekranu"
          value={tekst}
          onChange={(e) => { setTekst(e.target.value); setBlad(''); }}
          onPaste={wklej}
          onKeyDown={obsluzKlawisz}
          rows={4}
        />

        {(linki.length > 0 || zdjecia.length > 0) && (
          <div className="kafelki">
            {linki.map((link) => (
              <span key={link} className="kafelek kafelek--link" title={link}>
                <Ikona nazwa="link" rozmiar={14} />
                {skrocLink(link)}
                <button type="button" className="kafelek__usun" onClick={() => usunLink(link)} aria-label={`Usuń link ${link}`}>
                  <Ikona nazwa="x" rozmiar={12} />
                </button>
              </span>
            ))}
            {zdjecia.map((z) => (
              <span key={z.id} className="kafelek kafelek--zdjecie" title={z.nazwa}>
                <button
                  type="button"
                  className="kafelek__podglad"
                  onClick={() => setPodgladZdjecia(z)}
                  aria-label={`Powiększ zdjęcie ${z.nazwa}`}
                >
                  <img src={z.dataUrl} alt="" className="kafelek__miniatura" />
                  {z.nazwa.length > 20 ? z.nazwa.slice(0, 18) + '…' : z.nazwa}
                </button>
                <button
                  type="button"
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

        {zdjecia.length > 0 && (
          <p className="pole__ocr-info">
            Ze zdjęć odczytujemy tekst (OCR). Jeśli na zrzucie brakuje daty lub źródła, dopisz je powyżej.
          </p>
        )}

        <div className="pole__dol">
          <button type="button" className="przycisk-maly" onClick={() => wyborPliku.current.click()}>
            <Ikona nazwa="zdjecie" rozmiar={16} />
            Dodaj zdjęcie
          </button>
          {typeof navigator !== 'undefined' && navigator.clipboard && (
            <button type="button" className="przycisk-maly" onClick={wklejPrzyciskiem}>
              Wklej ze schowka
            </button>
          )}
          <span className="pole__podpowiedz">lub Ctrl+V, przeciągnij plik</span>
          {(podsumowanie.length > 0 || tekst.length >= 500) && (
            <span className={`pole__licznik ${zaDlugiTekst ? 'pole__licznik--blad' : ''}`}>
              {[
                ...podsumowanie,
                tekst.length >= 500 && `${tekst.length.toLocaleString('pl-PL')} / ${MAX_ZNAKOW.toLocaleString('pl-PL')} zn.`,
              ].filter(Boolean).join(' · ')}
            </span>
          )}
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

      {!tekst.trim() && zdjecia.length === 0 && (
        <div className="przyklady">
          <span className="przyklady__etykieta">Przykłady:</span>
          {PRZYKLADY.map((p) => (
            <button
              key={p.etykieta}
              type="button"
              className="przyklad"
              onClick={() => {
                setTekst(p.tekst);
                setBlad('');
                poleTekstu.current?.focus();
              }}
            >
              {p.etykieta}
            </button>
          ))}
        </div>
      )}

      {blad && <p className="blad">{blad}</p>}

      <button className="przycisk-glowny" onClick={wyslij}>
        Weryfikuj
      </button>

      <ul className="zalety">
        <li><Ikona nazwa="check" rozmiar={16} />Teksty, linki i zrzuty ekranu</li>
        <li><Ikona nazwa="check" rozmiar={16} />Oficjalne źródła i fact-checkerzy</li>
        <li><Ikona nazwa="check" rozmiar={16} />Werdykt z listą źródeł</li>
      </ul>

      <PodgladObrazu obraz={podgladZdjecia} onZamknij={() => setPodgladZdjecia(null)} />
    </div>
  );
}
