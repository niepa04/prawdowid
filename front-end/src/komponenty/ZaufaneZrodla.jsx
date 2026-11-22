import { useEffect, useMemo, useState } from 'react';
import Ikona from './Ikona.jsx';
import { bezpiecznyUrl } from '../api.js';

// Strona "Zaufane źródła" (#zrodla): lista źródeł z katalogu serwera (config/zrodla/),
// opis Google Fact Check Tools API i wymagania, które musi spełnić strona, żeby trafić na listę.
export default function ZaufaneZrodla({ onWroc }) {
  const [dane, setDane] = useState(null);
  const [blad, setBlad] = useState('');
  const [filtr, setFiltr] = useState('');

  useEffect(() => {
    let aktywny = true;
    fetch('/api/zrodla')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => aktywny && setDane(d))
      .catch(() => aktywny && setBlad('Nie udało się pobrać listy źródeł z serwera. Sprawdź, czy serwer Koma działa.'));
    return () => {
      aktywny = false;
    };
  }, []);

  // Źródła oficjalne pogrupowane według kategorii (z filtrem po nazwie i domenie)
  const grupy = useMemo(() => {
    if (!dane) return [];
    const f = filtr.trim().toLowerCase();
    const mapa = new Map();
    for (const z of dane.oficjalne) {
      if (f && !`${z.nazwa} ${z.domena}`.toLowerCase().includes(f)) continue;
      if (!mapa.has(z.kategoria_nazwa)) mapa.set(z.kategoria_nazwa, []);
      mapa.get(z.kategoria_nazwa).push(z);
    }
    return [...mapa.entries()];
  }, [dane, filtr]);

  return (
    <div className="zrodla-strona">
      <button type="button" className="zrodla-strona__wroc" onClick={onWroc}>
        <Ikona nazwa="strzalka" rozmiar={16} />
        Wróć do sprawdzania
      </button>

      <h1 className="zrodla-strona__tytul">Zaufane źródła</h1>
      {dane && <p className="zrodla-strona__wstep">{dane.wstep}</p>}
      {blad && <p className="komunikat-bledu" role="alert">{blad}</p>}
      {!dane && !blad && <p className="zrodla-strona__wstep">Wczytywanie listy źródeł…</p>}

      {dane && (
        <>
          <div className="zrodla-liczby">
            <div className="zrodla-liczby__kafel">
              <strong>{dane.oficjalne.length}</strong>
              <span>źródeł urzędowych</span>
            </div>
            <div className="zrodla-liczby__kafel">
              <strong>{dane.fact_checkerzy.length}</strong>
              <span>niezależnych fact-checkerów</span>
            </div>
            <div className="zrodla-liczby__kafel">
              <strong>{Object.keys(dane.kategorie).length}</strong>
              <span>obszarów tematycznych</span>
            </div>
          </div>

          <section className="zrodla-sekcja">
            <div className="zrodla-sekcja__gora">
              <h2>Źródła urzędowe</h2>
              <input
                type="search"
                className="zrodla-szukaj"
                placeholder="Szukaj po nazwie lub domenie…"
                value={filtr}
                onChange={(e) => setFiltr(e.target.value)}
                aria-label="Szukaj źródła"
              />
            </div>
            {grupy.length === 0 && <p className="zrodla-pusto">Brak źródeł pasujących do „{filtr}”.</p>}
            {grupy.map(([kategoria, zrodla]) => (
              <div key={kategoria} className="zrodla-grupa">
                <h3>{kategoria}</h3>
                <ul className="zrodla-lista">
                  {zrodla.map((z) => {
                    const url = bezpiecznyUrl(z.url);
                    return (
                      <li key={z.id} className="zrodla-lista__el">
                        <div className="zrodla-lista__tresc">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer noopener" className="zrodla-lista__nazwa">
                              {z.nazwa}
                            </a>
                          ) : (
                            <span className="zrodla-lista__nazwa">{z.nazwa}</span>
                          )}
                          <span className="zrodla-lista__domena">{z.domena}</span>
                        </div>
                        {z.rola && <span className="zrodla-lista__rola">{z.rola}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>

          <section className="zrodla-sekcja">
            <h2>Niezależni fact-checkerzy</h2>
            <ul className="zrodla-lista">
              {dane.fact_checkerzy.map((f) => (
                <li key={f.domena} className="zrodla-lista__el">
                  <div className="zrodla-lista__tresc">
                    <a href={bezpiecznyUrl(f.url) || undefined} target="_blank" rel="noreferrer noopener" className="zrodla-lista__nazwa">
                      {f.domena}
                    </a>
                    <span className="zrodla-lista__domena">
                      {f.czytamy_artykuly ? 'oceny z bazy Google + artykuły czytane bezpośrednio' : 'oceny z bazy Google Fact Check Tools'}
                    </span>
                  </div>
                  <span className="zrodla-lista__rola">fact-checker</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="zrodla-sekcja zrodla-sekcja--api">
            <div className="zrodla-sekcja__gora">
              <h2>{dane.fact_check_api.nazwa}</h2>
              <span className={`plakietka ${dane.fact_check_api.aktywne ? 'plakietka--prawda' : 'plakietka--brak'}`}>
                {dane.fact_check_api.aktywne ? 'połączone' : 'niepodłączone na tym serwerze'}
              </span>
            </div>
            <p>{dane.fact_check_api.opis}</p>
            <ul className="zrodla-punkty">
              {dane.fact_check_api.zasady.map((z) => <li key={z}>{z}</li>)}
            </ul>
          </section>

          <section className="zrodla-sekcja">
            <h2>Jak strona trafia na listę zaufanych źródeł</h2>
            <p>Źródło dodajemy dopiero wtedy, gdy spełnia wszystkie poniższe wymagania:</p>
            <ol className="zrodla-wymagania">
              {dane.wymagania.map((w, i) => (
                <li key={w.tytul}>
                  <span className="zrodla-wymagania__nr">{i + 1}</span>
                  <div>
                    <strong>{w.tytul}</strong>
                    <p>{w.opis}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
