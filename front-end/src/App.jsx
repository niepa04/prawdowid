import { useRef, useState } from 'react';
import PoleWejscia from './komponenty/PoleWejscia.jsx';
import Sprawdzanie from './komponenty/Sprawdzanie.jsx';
import Wynik from './komponenty/Wynik.jsx';
import Ikona from './komponenty/Ikona.jsx';
import { weryfikuj } from './api.js';

// Trzy etapy strony: wpisywanie -> sprawdzanie -> wynik (albo błąd).
export default function App() {
  const [etap, setEtap] = useState('wpisywanie');
  const [zgloszenie, setZgloszenie] = useState(null);
  const [wynik, setWynik] = useState(null);
  const [blad, setBlad] = useState('');
  const numerZapytania = useRef(0);

  async function sprawdz(dane) {
    const numer = ++numerZapytania.current;
    setZgloszenie(dane);
    setWynik(null);
    setBlad('');
    setEtap('sprawdzanie');
    try {
      const odp = await weryfikuj(dane);
      if (numer !== numerZapytania.current) return; // użytkownik w międzyczasie zaczął od nowa
      setWynik(odp);
      setEtap('wynik');
    } catch (err) {
      if (numer !== numerZapytania.current) return;
      setBlad(err.message);
      setEtap('blad');
    }
  }

  function odNowa() {
    numerZapytania.current++;
    setZgloszenie(null);
    setWynik(null);
    setBlad('');
    setEtap('wpisywanie');
  }

  return (
    <div className="strona">
      <header className="gora">
        <div className="szerokosc gora__wnetrze">
          <button className="znak" onClick={odNowa} aria-label="Koma, strona główna">
            <span className="znak__kwadrat">K</span>
            <span className="znak__nazwa">Koma</span>
          </button>
          <nav className="gora__menu">
            <a href="#jak-to-dziala">Jak to działa</a>
            <a href="#o-projekcie">O projekcie</a>
          </nav>
        </div>
      </header>

      <main className="szerokosc tresc">
        <div className="naglowek">
          <h1 className="logo">Koma</h1>
          <p className="rozwiniecie">
            <strong>K</strong>oniec <strong>o</strong>szustw, <strong>m</strong>anipulacji i <strong>a</strong>bsurdów
          </p>
          <p className="haslo">Sprawdź, zanim udostępnisz</p>
        </div>

        <section className="panel">
          {etap === 'wpisywanie' && <PoleWejscia onSprawdz={sprawdz} />}
          {etap === 'sprawdzanie' && <Sprawdzanie zgloszenie={zgloszenie} onAnuluj={odNowa} />}
          {etap === 'wynik' && <Wynik wynik={wynik} onOdNowa={odNowa} />}
          {etap === 'blad' && (
            <div className="komunikat-bledu" role="alert">
              <h2>Nie udało się sprawdzić informacji</h2>
              <p>{blad}</p>
              <div className="komunikat-bledu__akcje">
                <button className="przycisk-drugi przycisk-drugi--glowny" onClick={() => sprawdz(zgloszenie)}>
                  <Ikona nazwa="odswiez" rozmiar={16} />
                  Spróbuj ponownie
                </button>
                <button className="przycisk-drugi" onClick={odNowa}>Wróć</button>
              </div>
            </div>
          )}
        </section>

        {etap === 'wpisywanie' && (
          <section className="baner" id="jak-to-dziala">
            <h2 className="baner__tytul">Jak działa Koma?</h2>
            <ol className="kroki">
              <li className="krok">
                <span className="krok__ikona"><Ikona nazwa="plik" rozmiar={22} /></span>
                <strong>Wklej informację</strong>
                <span>Tekst, link do artykułu albo zrzut ekranu z mediów społecznościowych.</span>
              </li>
              <li className="krok">
                <span className="krok__ikona"><Ikona nazwa="lupa" rozmiar={22} /></span>
                <strong>Koma ją przeanalizuje</strong>
                <span>Odczyta tekst ze zdjęć, pobierze artykuły i wybierze to, co dotyczy tematu.</span>
              </li>
              <li className="krok">
                <span className="krok__ikona"><Ikona nazwa="tarcza" rozmiar={22} /></span>
                <strong>Dostaniesz werdykt</strong>
                <span>Porówna podane informacje ze zweryfikowaną bazą faktów, na podstawie której dowiesz się prawdy.</span>
              </li>
            </ol>
          </section>
        )}
      </main>

      <footer className="dol" id="o-projekcie">
        <div className="szerokosc">
          <nav className="dol__linki">
            <a href="#o-projekcie">O projekcie</a>
            <a href="#jak-to-dziala">Jak to działa</a>
            <a href="#kontakt">Kontakt</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
