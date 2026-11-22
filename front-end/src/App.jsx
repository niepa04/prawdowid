import { useRef, useState } from 'react';
import PoleWejscia from './komponenty/PoleWejscia.jsx';
import Sprawdzanie from './komponenty/Sprawdzanie.jsx';
import Wynik from './komponenty/Wynik.jsx';
import Ikona from './komponenty/Ikona.jsx';
import logoZnak from './assets/logo-znak.png';
import { weryfikuj } from './api.js';

// Trzy etapy strony: wpisywanie -> sprawdzanie -> wynik (albo błąd).
export default function App() {
  const [etap, setEtap] = useState('wpisywanie');
  const [robocze, setRobocze] = useState({ tekst: '', zdjecia: [] });
  const [kluczPola, setKluczPola] = useState(0);
  const [zgloszenie, setZgloszenie] = useState(null);
  const [wynik, setWynik] = useState(null);
  const [blad, setBlad] = useState('');
  const numerZapytania = useRef(0);

  async function sprawdz(dane) {
    const numer = ++numerZapytania.current;
    setRobocze({ tekst: dane.tekst, zdjecia: dane.zdjecia });
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

  // Powrót do pola z zachowaniem wpisanego tekstu i zdjęć (np. po Anuluj, błędzie lub „Popraw treść”)
  function wrocDoEdycji() {
    numerZapytania.current++;
    setWynik(null);
    setBlad('');
    setEtap('wpisywanie');
  }

  function odNowa() {
    numerZapytania.current++;
    setRobocze({ tekst: '', zdjecia: [] });
    setZgloszenie(null);
    setWynik(null);
    setBlad('');
    setEtap('wpisywanie');
    setKluczPola((k) => k + 1);
  }

  function pokazJakDziala(e) {
    if (etap === 'wpisywanie') return;
    e.preventDefault();
    wrocDoEdycji();
    requestAnimationFrame(() => {
      document.getElementById('jak-to-dziala')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  return (
    <div className="strona">
      <header className="gora">
        <div className="szerokosc gora__wnetrze">
          <button className="znak" onClick={odNowa} aria-label="Koma, strona główna">
            <img src={logoZnak} alt="" className="znak__logo" />
            <span className="znak__nazwa">Koma</span>
          </button>
          <nav className="gora__menu">
            <a href="#jak-to-dziala" onClick={pokazJakDziala}>Jak to działa</a>
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
          {etap === 'wpisywanie' && <PoleWejscia key={kluczPola} poczatkowe={robocze} onSprawdz={sprawdz} />}
          {etap === 'sprawdzanie' && <Sprawdzanie zgloszenie={zgloszenie} onAnuluj={wrocDoEdycji} />}
          {etap === 'wynik' && <Wynik wynik={wynik} zgloszenie={zgloszenie} onPopraw={wrocDoEdycji} onOdNowa={odNowa} />}
          {etap === 'blad' && (
            <div className="komunikat-bledu" role="alert">
              <h2>Nie udało się sprawdzić informacji</h2>
              <p>{blad}</p>
              <div className="komunikat-bledu__akcje">
                <button className="przycisk-drugi przycisk-drugi--glowny" onClick={() => sprawdz(zgloszenie)}>
                  <Ikona nazwa="odswiez" rozmiar={16} />
                  Spróbuj ponownie
                </button>
                <button className="przycisk-drugi" onClick={wrocDoEdycji}>Wróć do edycji</button>
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
                <span>Sprawdzi treść w oficjalnych źródłach oraz u niezależnych fact-checkerów.</span>
              </li>
            </ol>
          </section>
        )}
      </main>

      <footer className="dol" id="o-projekcie">
        <div className="szerokosc">
          <nav className="dol__linki">
            <a href="#o-projekcie">O projekcie</a>
            <a href="#jak-to-dziala" onClick={pokazJakDziala}>Jak to działa</a>
          </nav>
          <p className="dol__info">
            Koma pomaga szybko sprawdzić informacje z sieci na podstawie oficjalnych źródeł i baz fact-checkingowych.
          </p>
        </div>
      </footer>
    </div>
  );
}
