import { useState } from 'react';
import Ikona from './Ikona.jsx';

export const WERDYKTY = {
  prawda: { nazwa: 'Prawda', opis: 'Informacja zgadza się z faktami.', stopien: 4 },
  czesciowo: { nazwa: 'Częściowa prawda', opis: 'Część informacji jest prawdziwa, część nie.', stopien: 3 },
  manipulacja: { nazwa: 'Manipulacja', opis: 'Fakty przedstawione w mylący sposób.', stopien: 2 },
  falsz: { nazwa: 'Fałsz', opis: 'Informacja nie zgadza się z faktami.', stopien: 1 },
};

const SKALA = ['falsz', 'manipulacja', 'czesciowo', 'prawda'];

export default function Wynik({ wynik, onOdNowa }) {
  const [rozwiniete, setRozwiniete] = useState(false);
  const [skopiowano, setSkopiowano] = useState(false);
  const werdykt = WERDYKTY[wynik.werdykt];

  async function kopiuj() {
    try {
      await navigator.clipboard.writeText(`Koma: ${werdykt.nazwa}\n${wynik.wyjasnienie}`);
      setSkopiowano(true);
      setTimeout(() => setSkopiowano(false), 2000);
    } catch {
      // brak dostępu do schowka, nic nie robimy
    }
  }

  return (
    <div className="wynik">
      <div className={`werdykt werdykt--${wynik.werdykt}`}>
        <div className="werdykt__etykieta">Werdykt</div>
        <div className="werdykt__nazwa">{werdykt.nazwa}</div>
        <div className="werdykt__opis">{werdykt.opis}</div>
      </div>

      <div className="skala" aria-hidden="true">
        {SKALA.map((s) => (
          <div key={s} className={`skala__krok ${s === wynik.werdykt ? `skala__krok--${s}` : ''}`}>
            <div className="skala__pasek" />
            <span>{WERDYKTY[s].nazwa}</span>
          </div>
        ))}
      </div>

      <p className="wyjasnienie">{wynik.wyjasnienie}</p>

      <h2 className="podtytul">Źródła z Demagoga</h2>
      <ul className="zrodla">
        {wynik.zrodla.map((z) => (
          <li key={z.tytul} className="zrodlo">
            <a href={z.url} target="_blank" rel="noreferrer" className="zrodlo__tytul">
              {z.tytul}
              <Ikona nazwa="zewnetrzny" rozmiar={14} />
            </a>
            <span className={`plakietka plakietka--${z.ocena}`}>{WERDYKTY[z.ocena].nazwa}</span>
          </li>
        ))}
      </ul>

      <button className="rozwin" onClick={() => setRozwiniete((r) => !r)} aria-expanded={rozwiniete}>
        <span className={`rozwin__strzalka ${rozwiniete ? 'rozwin__strzalka--otwarta' : ''}`}>
          <Ikona nazwa="strzalka" rozmiar={16} />
        </span>
        Co odczytaliśmy z Twojego zgłoszenia
      </button>
      {rozwiniete && (
        <div className="odczytano">
          {[
            ['Tekst', wynik.odczytano.tekst],
            ['Z linków', wynik.odczytano.linki],
            ['Ze zdjęć', wynik.odczytano.zdjecia],
          ]
            .filter(([, t]) => t)
            .map(([nazwa, t]) => (
              <div key={nazwa}>
                <div className="odczytano__nazwa">{nazwa}</div>
                <p className="odczytano__tekst">{t}</p>
              </div>
            ))}
        </div>
      )}

      <div className="akcje">
        <button className="przycisk-drugi" onClick={kopiuj}>
          <Ikona nazwa={skopiowano ? 'check' : 'kopiuj'} rozmiar={16} />
          {skopiowano ? 'Skopiowano' : 'Kopiuj wynik'}
        </button>
        <button className="przycisk-drugi">
          <Ikona nazwa="udostepnij" rozmiar={16} />
          Udostępnij
        </button>
        <button className="przycisk-drugi przycisk-drugi--glowny" onClick={onOdNowa}>
          <Ikona nazwa="odswiez" rozmiar={16} />
          Sprawdź coś innego
        </button>
      </div>
    </div>
  );
}
