import { useState } from 'react';
import Ikona from './Ikona.jsx';
import PodgladZgloszenia from './PodgladZgloszenia.jsx';
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

function Plakietka({ nazwa }) {
  return <span className={`plakietka plakietka--${werdykt(nazwa).klasa}`}>{nazwa}</span>;
}

// Dzieli twierdzenia na wątki: wątek = twierdzenie główne (bez related_to w Modelu 2)
// + twierdzenia szczegółowe, które się do niego odnoszą.
function podzielNaWatki(twierdzenia, claimsModelu2) {
  const powiazania = new Map((claimsModelu2 || []).map((c) => [c.id, Array.isArray(c.related_to) ? c.related_to : []]));
  const glowne = twierdzenia.filter((t) => !(powiazania.get(t.claim_id) || []).some((id) => twierdzenia.some((x) => x.claim_id === id)));
  const watki = (glowne.length ? glowne : twierdzenia).map((t) => ({ glowne: t, szczegoly: [] }));
  for (const t of twierdzenia) {
    if (watki.some((w) => w.glowne === t)) continue;
    const rodzic = (powiazania.get(t.claim_id) || [])[0];
    const watek = watki.find((w) => w.glowne.claim_id === rodzic) || watki[0];
    watek.szczegoly.push(t);
  }
  return watki;
}

function Szczegoly({ szczegoly }) {
  if (!szczegoly.length) return null;
  return (
    <ul className="szczegoly">
      {szczegoly.map((s) => (
        <li key={s.claim_id} className="szczegol">
          <div className="szczegol__gora">
            <span className="szczegol__etykieta">Szczegół</span>
            <span className="szczegol__tresc">{String(s.claim).replace(/\s*\(dotyczy:[^)]*\)\s*$/, '')}</span>
            <Plakietka nazwa={s.werdykt} />
          </div>
          {s.uzasadnienie && <p className="szczegol__uzasadnienie">{s.uzasadnienie}</p>}
        </li>
      ))}
    </ul>
  );
}

// Jeden wątek jako karta: twierdzenie, werdykt, uzasadnienie, źródła i szczegóły
function KartaWatku({ watek, numer }) {
  const t = watek.glowne;
  const w = werdykt(t.werdykt);
  const zrodla = (t.uzyte_zrodla || []).slice(0, 3);
  return (
    <li className={`karta-watku karta-watku--${w.klasa}`}>
      <div className="karta-watku__gora">
        <span className="karta-watku__numer">{numer}</span>
        <p className="karta-watku__twierdzenie">„{t.claim}”</p>
      </div>
      <div className={`karta-watku__werdykt werdykt--${w.klasa}`}>{t.werdykt}</div>
      {t.uzasadnienie && <p className="karta-watku__uzasadnienie">{t.uzasadnienie}</p>}
      {zrodla.length > 0 && (
        <ul className="zrodla zrodla--male">
          {zrodla.map((z) => <Zrodlo key={z.url || z.title} zrodlo={z} />)}
        </ul>
      )}
      <Szczegoly szczegoly={watek.szczegoly} />
    </li>
  );
}

// Podsumowanie kilku wątków: ile z nich dostało który werdykt
function Podsumowanie({ watki, nazwaOgolna }) {
  const liczby = new Map();
  for (const w of watki) liczby.set(w.glowne.werdykt, (liczby.get(w.glowne.werdykt) || 0) + 1);
  const ogolny = werdykt(nazwaOgolna);
  return (
    <div className={`podsumowanie werdykt--${ogolny.klasa}`}>
      <div className="werdykt__etykieta">Werdykt ogólny</div>
      <div className="podsumowanie__nazwa">{nazwaOgolna}</div>
      <p className="podsumowanie__opis">
        Sprawdziliśmy {watki.length} {watki.length < 5 ? 'wątki' : 'wątków'}. Każdy z nich oceniamy osobno poniżej.
      </p>
      <div className="podsumowanie__liczby">
        {[...liczby.entries()].map(([nazwa, ile]) => (
          <span key={nazwa} className={`plakietka plakietka--${werdykt(nazwa).klasa}`}>
            {ile} × {nazwa}
          </span>
        ))}
      </div>
    </div>
  );
}

// Notatka Research Gatherera: co sprawdzaliśmy, co ustaliliśmy (z numerami źródeł) i czego nie
function NotatkaResearchu({ research }) {
  const [otwarta, setOtwarta] = useState(false);
  if (!research?.notatka) return null;
  const { plan, notatka, materialy = [] } = research;
  const poNr = new Map(materialy.map((m) => [m.nr, m]));
  return (
    <>
      <button className="rozwin" onClick={() => setOtwarta((o) => !o)} aria-expanded={otwarta}>
        <span className={`rozwin__strzalka ${otwarta ? 'rozwin__strzalka--otwarta' : ''}`}>
          <Ikona nazwa="strzalka" rozmiar={16} />
        </span>
        Notatka z researchu ({materialy.length} {materialy.length === 1 ? 'materiał' : 'materiałów'})
      </button>
      {otwarta && (
        <div className="notatka">
          {plan?.temat && <p className="notatka__temat">Temat: {plan.temat}</p>}
          {plan?.pytania_badawcze?.length > 0 && (
            <>
              <div className="notatka__naglowek">Co sprawdzaliśmy</div>
              <ul>{plan.pytania_badawcze.map((p) => <li key={p.pytanie}>{p.pytanie}</li>)}</ul>
            </>
          )}
          {notatka.streszczenie && <p>{notatka.streszczenie}</p>}
          {notatka.ustalenia?.length > 0 && (
            <>
              <div className="notatka__naglowek">Ustalenia</div>
              <ul>
                {notatka.ustalenia.map((u, i) => (
                  <li key={i}>
                    {u.tresc}{' '}
                    {(u.zrodla || []).map((nr) => {
                      const m = poNr.get(nr);
                      const url = m && bezpiecznyUrl(m.url);
                      return url ? (
                        <a key={nr} href={url} target="_blank" rel="noreferrer noopener" className="notatka__przypis" title={m.tytul}>
                          [{nr}]
                        </a>
                      ) : null;
                    })}
                  </li>
                ))}
              </ul>
            </>
          )}
          {notatka.luki?.length > 0 && (
            <>
              <div className="notatka__naglowek">Czego nie udało się ustalić</div>
              <ul>{notatka.luki.map((l) => <li key={l}>{l}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </>
  );
}

// wynik: pełna odpowiedź /api/weryfikuj (Model 1 -> Research Gatherer -> Weryfikator Prawdy)
export default function Wynik({ wynik, zgloszenie, onPopraw, onOdNowa }) {
  const [pokazOdczyt, setPokazOdczyt] = useState(false);
  const [skopiowano, setSkopiowano] = useState(false);

  const dem = wynik.demagog || {};
  const nazwa = dem.werdykt_ogolny || wynik.werdykt_ogolny || 'Brak wystarczających dowodów';
  const w = werdykt(nazwa);
  const twierdzenia = dem.twierdzenia || [];
  const watki = podzielNaWatki(twierdzenia, wynik.model2?.claims);
  const wieleWatkow = watki.length > 1;
  const ostrzezenia = wynik.metadane?.ostrzezenia || [];
  const czas = wynik.metadane?.czas_calkowity_ms;

  async function kopiuj() {
    const tekst = wieleWatkow
      ? [`Koma – werdykt ogólny: ${nazwa}`, ...watki.map((x, i) => `${i + 1}. „${x.glowne.claim}” – ${x.glowne.werdykt}. ${x.glowne.uzasadnienie || ''}`)].join('\n')
      : `Koma: ${nazwa}\n${dem.glowna_odpowiedz || ''}`;
    try {
      await navigator.clipboard.writeText(tekst);
      setSkopiowano(true);
      setTimeout(() => setSkopiowano(false), 2000);
    } catch {
      // brak dostępu do schowka
    }
  }

  return (
    <div className="wynik">
      {wieleWatkow ? (
        <>
          <Podsumowanie watki={watki} nazwaOgolna={nazwa} />
          <ol className="watki">
            {watki.map((watek, i) => <KartaWatku key={watek.glowne.claim_id} watek={watek} numer={i + 1} />)}
          </ol>
        </>
      ) : (
        <>
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

          {(watki[0]?.glowne.claim || dem.glowny_kontekst_twierdzenie) ? (
            <div className="twierdzenie-glowne">
              <div className="twierdzenie-glowne__etykieta">Sprawdzane twierdzenie</div>
              <p>„{watki[0]?.glowne.claim || dem.glowny_kontekst_twierdzenie}”</p>
            </div>
          ) : (
            <PodgladZgloszenia zgloszenie={zgloszenie} />
          )}

          {(watki[0]?.glowne.uzasadnienie || dem.glowna_odpowiedz) && (
            <p className="wyjasnienie">{watki[0]?.glowne.uzasadnienie || dem.glowna_odpowiedz}</p>
          )}

          {(watki[0]?.glowne.uzyte_zrodla || dem.glowne_zrodla || []).length > 0 && (
            <>
              <h2 className="podtytul">Źródła</h2>
              <ul className="zrodla">
                {(watki[0]?.glowne.uzyte_zrodla || dem.glowne_zrodla).map((z) => <Zrodlo key={z.url || z.title} zrodlo={z} />)}
              </ul>
            </>
          )}

          {watki[0] && <Szczegoly szczegoly={watki[0].szczegoly} />}
        </>
      )}

      {ostrzezenia.length > 0 && (
        <ul className="ostrzezenia">
          {ostrzezenia.map((o) => <li key={o}>{o}</li>)}
        </ul>
      )}

      <NotatkaResearchu research={wynik.research} />

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
        {onPopraw && (
          <button className="przycisk-drugi" onClick={onPopraw}>
            Popraw treść
          </button>
        )}
        <button className="przycisk-drugi przycisk-drugi--glowny" onClick={onOdNowa}>
          <Ikona nazwa="odswiez" rozmiar={16} />
          Sprawdź coś innego
        </button>
      </div>
      {czas != null && <p className="czas">Sprawdzono w {Math.round(czas / 1000)} s</p>}
    </div>
  );
}
