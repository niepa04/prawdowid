import { useRef, useState } from 'react';
import PoleWejscia from './komponenty/PoleWejscia.jsx';
import Sprawdzanie from './komponenty/Sprawdzanie.jsx';
import Wynik from './komponenty/Wynik.jsx';
import Ikona from './komponenty/Ikona.jsx';
import ZasadyModal from './komponenty/ZasadyModal.jsx';
import logoZnak from './assets/logo-znak.png';
import { weryfikuj } from './api.js';
import { werdykt } from './werdykty.js';
import { wczytajHistorie, zapiszWHistorii, usunZHistorii, wyczyscHistorie } from './historia.js';

// Trzy etapy strony: wpisywanie -> sprawdzanie -> wynik (albo błąd).
export default function App() {
  const [etap, setEtap] = useState('wpisywanie');
  const [robocze, setRobocze] = useState({ tekst: '', zdjecia: [] });
  const [kluczPola, setKluczPola] = useState(0);
  const [zgloszenie, setZgloszenie] = useState(null);
  const [wynik, setWynik] = useState(null);
  const [blad, setBlad] = useState('');
  const [historia, setHistoria] = useState(() => wczytajHistorie());
  const [otwarteZasady, setOtwarteZasady] = useState(false);
  const [duzyTekst, setDuzyTekst] = useState(() => {
    try {
      return localStorage.getItem('koma_duzy_tekst') === '1';
    } catch {
      return false;
    }
  });
  const numerZapytania = useRef(0);

  function przelaczRozmiarTekstu() {
    setDuzyTekst((d) => {
      const nowy = !d;
      try {
        localStorage.setItem('koma_duzy_tekst', nowy ? '1' : '0');
      } catch {
        // pomijamy
      }
      return nowy;
    });
  }

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
      setHistoria(zapiszWHistorii({ zgloszenie: dane, wynik: odp }));
      setWynik(odp);
      setEtap('wynik');
    } catch (err) {
      if (numer !== numerZapytania.current) return;
      setBlad(err.message);
      setEtap('blad');
    }
  }

  function otworzZHistorii(wpis) {
    numerZapytania.current++;
    const odtworzone = { tekst: wpis.tekst || '', zdjecia: [] };
    setRobocze(odtworzone);
    setZgloszenie(odtworzone);
    setWynik(wpis.wynik);
    setBlad('');
    setEtap('wynik');
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
    <div className={`strona ${duzyTekst ? 'duzy-tekst' : ''}`}>
      <header className="gora">
        <div className="szerokosc gora__wnetrze">
          <button className="znak" onClick={odNowa} aria-label="Koma, strona główna">
            <img src={logoZnak} alt="" className="znak__logo" />
            <span className="znak__nazwa">Koma</span>
          </button>
          <nav className="gora__menu">
            <a href="#jak-to-dziala" onClick={pokazJakDziala}>Jak to działa</a>
            <button type="button" className="gora__przycisk" onClick={() => setOtwarteZasady(true)}>
              Źródła i zasady
            </button>
            <button
              type="button"
              className={`przycisk-tekstu ${duzyTekst ? 'przycisk-tekstu--aktywny' : ''}`}
              onClick={przelaczRozmiarTekstu}
              aria-pressed={duzyTekst}
              title="Powiększ rozmiar tekstu"
            >
              A+
            </button>
          </nav>
        </div>
      </header>

      <main className="szerokosc tresc">
        <div className="naglowek">
          <h1 className="logo">Koma</h1>
          <p className="rozwiniecie">
            <strong>K</strong>atalog <strong>O</strong>biektywnych <strong>M</strong>ateriałów i <strong>A</strong>naliz
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

        {etap === 'wpisywanie' && historia.length > 0 && (
          <section className="historia" aria-label="Ostatnie sprawdzenia w tej przeglądarce">
            <div className="historia__gora">
              <h2 className="historia__tytul">Ostatnie sprawdzenia</h2>
              <button
                type="button"
                className="historia__wyczysc"
                onClick={() => setHistoria(wyczyscHistorie())}
              >
                Wyczyść sesję
              </button>
            </div>
            <ul className="historia__lista">
              {historia.map((wpis) => {
                const opis = wpis.tekst || `${wpis.liczbaZdjec || 1} zdjęcie do sprawdzenia`;
                const klasa = wpis.werdykt === 'Wymaga doprecyzowania' ? 'brak' : werdykt(wpis.werdykt).klasa;
                return (
                  <li key={wpis.id} className="historia__element">
                    <button
                      type="button"
                      className="historia__otworz"
                      onClick={() => otworzZHistorii(wpis)}
                    >
                      <span className="historia__tekst">
                        {opis.length > 90 ? `${opis.slice(0, 88)}…` : opis}
                      </span>
                      <span className={`plakietka plakietka--${klasa}`}>{wpis.werdykt}</span>
                    </button>
                    <button
                      type="button"
                      className="historia__usun"
                      onClick={() => setHistoria(usunZHistorii(wpis.id))}
                      aria-label="Usuń z historii"
                    >
                      <Ikona nazwa="x" rozmiar={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

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
            <button type="button" className="dol__przycisk" onClick={() => setOtwarteZasady(true)}>
              Źródła, zasady i prywatność
            </button>
            <a href="#jak-to-dziala" onClick={pokazJakDziala}>Jak to działa</a>
          </nav>
          <p className="dol__info">
            Koma pomaga szybko sprawdzić informacje z sieci na podstawie oficjalnych źródeł i baz fact-checkingowych.
          </p>
        </div>
      </footer>

      <ZasadyModal
        otwarte={otwarteZasady}
        onZamknij={() => setOtwarteZasady(false)}
        liczbaHistorii={historia.length}
        onWyczyscHistorie={() => setHistoria(wyczyscHistorie())}
      />
    </div>
  );
}
