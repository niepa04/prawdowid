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
    const nowe = await Promise.all(
      obrazy.map(async (p) => ({ id: crypto.randomUUID(), nazwa: p.name || 'wklejone zdjęcie', dataUrl: await jakoBase64(p) }))
    );
    if (nowe.length) {
      setZdjecia((z) => [...z, ...nowe]);
      setBlad('');
    }
  }

  function wklej(e) {
    const pliki = [...e.clipboardData.files].filter((p) => p.type.startsWith('image/'));
    if (pliki.length) {
      e.preventDefault();
      dodajZdjecia(pliki);
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
