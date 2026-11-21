import { useState } from 'react';
import Ikona from './Ikona.jsx';
import { werdykt, SKALA } from '../werdykty.js';
import { bezpiecznyUrl } from '../api.js';

function Zrodlo({ zrodlo }) {
  const url = bezpiecznyUrl(zrodlo.url);
  const tytul = zrodlo.title || zrodlo.publisher || zrodlo.url;
  return (
    <li className="zrodlo">
      <div className="zrodlo__tresc">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer noopener" className="zrodlo__tytul">
            {tytul}
            <Ikona nazwa="zewnetrzny" rozmiar={14} />
          </a>
        ) : (
          <span className="zrodlo__tytul">{tytul}</span>
        )}
        {zrodlo.publisher && zrodlo.title && <span className="zrodlo__wydawca">{zrodlo.publisher}</span>}
      </div>
    </li>
  );
}

// wynik: pełna odpowiedź /api/weryfikuj (pipeline: model1, model2, model3, demagog)
export default function Wynik({ wynik, onOdNowa }) {
  const [pokazTwierdzenia, setPokazTwierdzenia] = useState(false);
  const [pokazOdczyt, setPokazOdczyt] = useState(false);
  const [skopiowano, setSkopiowano] = useState(false);

  const dem = wynik.demagog || {};
  const nazwa = dem.werdykt_ogolny || wynik.werdykt_ogolny || 'Brak wystarczających dowodów';
  const w = werdykt(nazwa);
  const twierdzenia = dem.twierdzenia || [];
  const zrodla = dem.glowne_zrodla || [];
  const ostrzezenia = wynik.metadane?.ostrzezenia || [];
  const czas = wynik.metadane?.czas_calkowity_ms;

  async function kopiuj() {
    try {
      await navigator.clipboard.writeText(`Koma: ${nazwa}\n${dem.glowna_odpowiedz || ''}`);
      setSkopiowano(true);
      setTimeout(() => setSkopiowano(false), 2000);
    } catch {
      // brak dostępu do schowka
    }
  }

  return (
    <div className="wynik">
      <div className={`werdykt werdykt--${w.klasa}`}>
        <div className="werdykt__etykieta">Werdykt</div>
        <div className="werdykt__nazwa">{nazwa}</div>
        <div className="werdykt__opis">{w.opis}</div>
      </div>

      {w.skala && (
        <div className="skala" aria-hidden="true">
          {SKALA.map((s) => (
            <div key={s} className={`skala__krok ${s === w.skala ? `skala__krok--${werdykt(s).klasa}` : ''}`}>
              <div className="skala__pasek" />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}

      {dem.glowny_kontekst_twierdzenie && (
        <div className="twierdzenie-glowne">
          <div className="twierdzenie-glowne__etykieta">Sprawdzane twierdzenie</div>
          <p>„{dem.glowny_kontekst_twierdzenie}”</p>
        </div>
      )}

      {dem.glowna_odpowiedz && <p className="wyjasnienie">{dem.glowna_odpowiedz}</p>}

      {ostrzezenia.length > 0 && (
        <ul className="ostrzezenia">
          {ostrzezenia.map((o) => <li key={o}>{o}</li>)}
        </ul>
      )}

      {zrodla.length > 0 && (
        <>
          <h2 className="podtytul">Źródła</h2>
          <ul className="zrodla">
            {zrodla.map((z) => <Zrodlo key={z.url || z.title} zrodlo={z} />)}
          </ul>
        </>
      )}

      {twierdzenia.length > 0 && (
        <>
          <button className="rozwin" onClick={() => setPokazTwierdzenia((p) => !p)} aria-expanded={pokazTwierdzenia}>
            <span className={`rozwin__strzalka ${pokazTwierdzenia ? 'rozwin__strzalka--otwarta' : ''}`}>
              <Ikona nazwa="strzalka" rozmiar={16} />
            </span>
            Wszystkie sprawdzone twierdzenia ({twierdzenia.length})
          </button>
          {pokazTwierdzenia && (
            <ul className="twierdzenia">
              {twierdzenia.map((t) => (
                <li key={t.claim_id} className="twierdzenie">
                  <div className="twierdzenie__gora">
                    <span className="twierdzenie__tresc">{t.claim}</span>
                    <span className={`plakietka plakietka--${werdykt(t.werdykt).klasa}`}>{t.werdykt}</span>
                  </div>
                  {t.uzasadnienie && <p className="twierdzenie__uzasadnienie">{t.uzasadnienie}</p>}
                  {t.uzyte_zrodla?.length > 0 && (
                    <ul className="zrodla zrodla--male">
                      {t.uzyte_zrodla.map((z) => <Zrodlo key={z.url || z.title} zrodlo={z} />)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {wynik.model1?.tekst && (
        <>
          <button className="rozwin" onClick={() => setPokazOdczyt((p) => !p)} aria-expanded={pokazOdczyt}>
            <span className={`rozwin__strzalka ${pokazOdczyt ? 'rozwin__strzalka--otwarta' : ''}`}>
              <Ikona nazwa="strzalka" rozmiar={16} />
            </span>
            Co odczytaliśmy z Twojego zgłoszenia
          </button>
          {pokazOdczyt && (
            <div className="odczytano">
              <p className="odczytano__tekst">{wynik.model1.tekst}</p>
            </div>
          )}
        </>
      )}

      <div className="akcje">
        <button className="przycisk-drugi" onClick={kopiuj}>
          <Ikona nazwa={skopiowano ? 'check' : 'kopiuj'} rozmiar={16} />
          {skopiowano ? 'Skopiowano' : 'Kopiuj wynik'}
        </button>
        <button className="przycisk-drugi przycisk-drugi--glowny" onClick={onOdNowa}>
          <Ikona nazwa="odswiez" rozmiar={16} />
          Sprawdź coś innego
        </button>
      </div>
      {czas != null && <p className="czas">Sprawdzono w {Math.round(czas / 1000)} s</p>}
    </div>
  );
}
