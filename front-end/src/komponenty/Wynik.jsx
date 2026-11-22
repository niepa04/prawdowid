import { useEffect, useRef, useState } from 'react';
import Ikona from './Ikona.jsx';
import PodgladZgloszenia from './PodgladZgloszenia.jsx';
import { werdykt, SKALA, silaPodstawy, formatujDate, czyArchiwalna, opisyBezpieczenstwa } from '../werdykty.js';
import { bezpiecznyUrl } from '../api.js';
import { odmiana } from '../odmiana.js';
import { budujTekstDoKopiowania, pobierzRaportJson, pobierzRaportCsv } from '../eksport.js';

function Zrodlo({ zrodlo }) {
  const url = bezpiecznyUrl(zrodlo.url);
  const tytul = zrodlo.title || zrodlo.publisher || zrodlo.url;
  const data = formatujDate(zrodlo.published_at);
  const archiwalne = czyArchiwalna(zrodlo.published_at);
  const meta = [zrodlo.title ? zrodlo.publisher : null, data].filter(Boolean).join(' · ');

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
        {(meta || archiwalne) && (
          <span className="zrodlo__wydawca">
            {meta}
            {archiwalne && <span className="zrodlo__archiwum">Starszy materiał</span>}
          </span>
        )}
      </div>
    </li>
  );
}

// Link ze zgłoszenia prowadzi do domeny z listy zaufanych źródeł - informujemy o tym,
// ale werdykt i tak opiera się na potwierdzeniach z INNYCH stron
function ZrodloZgloszenia({ zrodlo }) {
  if (!zrodlo?.zaufane?.length) return null;
  return (
    <div className="zrodlo-zgloszenia" role="note">
      <div className="zrodlo-zgloszenia__ikona" aria-hidden="true">
        <Ikona nazwa="check" rozmiar={18} />
      </div>
      <div>
        <div className="zrodlo-zgloszenia__tytul">Zweryfikowane źródło</div>
        <p className="zrodlo-zgloszenia__opis">{zrodlo.komunikat}</p>
      </div>
    </div>
  );
}

function Plakietka({ nazwa }) {
  return <span className={`plakietka plakietka--${werdykt(nazwa).klasa}`}>{nazwa}</span>;
}

function SilaDowodow({ poziom, metoda, zwarta = false }) {
  const info = silaPodstawy(poziom, metoda);
  if (!info) return null;
  return (
    <div className={`sila sila--${info.klasa} ${zwarta ? 'sila--zwarta' : ''}`}>
      <strong>{info.etykieta}</strong>
      {!zwarta && <span>{info.opis}</span>}
    </div>
  );
}

function DowodyCytaty({ dowody }) {
  const istotne = [];
  const widziane = new Set();
  for (const d of dowody || []) {
    if (!d?.na_temat || !d.dlaczego) continue;
    if (d.stanowisko !== 'potwierdza' && d.stanowisko !== 'zaprzecza') continue;
    const klucz = `${d.stanowisko}|${d.dlaczego.trim()}`;
    if (widziane.has(klucz)) continue;
    widziane.add(klucz);
    istotne.push(d);
    if (istotne.length >= 4) break;
  }
  if (!istotne.length) return null;

  return (
    <div className="cytaty">
      <div className="cytaty__naglowek">Fragmenty ze źródeł</div>
      <ul className="cytaty__lista">
        {istotne.map((d, i) => {
          const url = bezpiecznyUrl(d.url);
          const etykieta = d.stanowisko === 'potwierdza' ? 'Potwierdza' : 'Zaprzecza';
          const klasa = d.stanowisko === 'potwierdza' ? 'prawda' : 'falsz';
          return (
            <li key={`${d.nr || i}-${i}`} className="cytat">
              <div className="cytat__gora">
                <span className={`plakietka plakietka--${klasa}`}>{etykieta}</span>
                {d.title && (
                  url ? (
                    <a href={url} target="_blank" rel="noreferrer noopener" className="cytat__zrodlo">
                      {d.title}
                    </a>
                  ) : (
                    <span className="cytat__zrodlo">{d.title}</span>
                  )
                )}
              </div>
              <blockquote className="cytat__tresc">„{d.dlaczego}”</blockquote>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
      <div className="karta-watku__werdykt-wiersz">
        <span className={`karta-watku__werdykt werdykt--${w.klasa}`}>{t.werdykt}</span>
        <SilaDowodow poziom={t.sila_dowodow} metoda={t.metoda} zwarta />
      </div>
      {t.uzasadnienie && <p className="karta-watku__uzasadnienie">{t.uzasadnienie}</p>}
      {zrodla.length > 0 && (
        <ul className="zrodla zrodla--male">
          {zrodla.map((z) => <Zrodlo key={z.url || z.title} zrodlo={z} />)}
        </ul>
      )}
      <div className="karta-watku__cytaty">
        <DowodyCytaty dowody={t.ocena_dowodow} />
      </div>
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
        Sprawdziliśmy {watki.length} {odmiana(watki.length, 'wątek', 'wątki', 'wątków')}. Każdy z nich oceniamy osobno poniżej.
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

function PetlaInformacji({ wynik }) {
  const rejestr = wynik.metadane?.nierozstrzygniete;
  const maNierozstrzygniete =
    wynik.werdykt_ogolny === 'Brak wystarczających dowodów' ||
    (wynik.demagog?.twierdzenia || []).some((t) => t.werdykt === 'Brak wystarczających dowodów');
  if (!maNierozstrzygniete || wynik.status === 'unavailable' || wynik.metadane?.niedostepne) return null;

  const przekazane = Boolean(rejestr && (rejestr.dodane > 0 || rejestr.zaktualizowane > 0));
  return (
    <div className="petla-info">
      <strong>
        {przekazane
          ? 'Sprawa przekazana do rejestru redakcyjnego'
          : 'Rekomendacja weryfikacji eksperckiej'}
      </strong>
      <p>
        {przekazane
          ? 'Ze względu na brak rozstrzygających źródeł temat został odnotowany w rejestrze spraw do uzupełnienia przez zespół.'
          : 'Dostępne źródła nie pozwalają jeszcze na pewne rozstrzygnięcie — zalecana jest dodatkowa weryfikacja przez moderatora.'}
      </p>
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
        Szczegóły analizy ({materialy.length} {odmiana(materialy.length, 'materiał', 'materiały', 'materiałów')})
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
  const [czytaGlosno, setCzytaGlosno] = useState(false);
  const kontenerRef = useRef(null);
  const obslugaMowy = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    kontenerRef.current?.focus({ preventScroll: true });
    kontenerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [wynik]);

  useEffect(() => {
    return () => {
      if (obslugaMowy) window.speechSynthesis.cancel();
    };
  }, [obslugaMowy]);

  const dem = wynik.demagog || {};
  const nazwa = dem.werdykt_ogolny || wynik.werdykt_ogolny || 'Brak wystarczających dowodów';
  const w = werdykt(nazwa);
  const twierdzenia = dem.twierdzenia || [];
  const watki = podzielNaWatki(twierdzenia, wynik.model2?.claims);
  const wieleWatkow = watki.length > 1;
  const ostrzezenia = wynik.metadane?.ostrzezenia || [];
  const flagiBezpieczenstwa = opisyBezpieczenstwa(wynik.metadane?.security_flags);
  const czas = wynik.metadane?.czas_calkowity_ms;
  const odrzucone = wynik.status === 'rejected' || Boolean(wynik.metadane?.odrzucone_przez_filtr);
  const niedostepne = wynik.status === 'unavailable' || Boolean(wynik.metadane?.niedostepne);
  const luki = wynik.research?.notatka?.luki || [];
  const glowneTwierdzenie = watki[0]?.glowne;
  const glowneZrodla = glowneTwierdzenie?.uzyte_zrodla || dem.glowne_zrodla || [];

  async function kopiuj() {
    const tekst = budujTekstDoKopiowania(wynik, watki);
    try {
      await navigator.clipboard.writeText(tekst);
      setSkopiowano(true);
      setTimeout(() => setSkopiowano(false), 2000);
    } catch {
      // brak dostępu do schowka
    }
  }

  function odsluchaj() {
    if (!obslugaMowy) return;
    if (czytaGlosno) {
      window.speechSynthesis.cancel();
      setCzytaGlosno(false);
      return;
    }
    const tekstMowy = [
      `${niedostepne ? 'Informacja techniczna' : 'Werdykt'}: ${nazwa}.`,
      dem.glowna_odpowiedz || glowneTwierdzenie?.uzasadnienie || '',
    ].filter(Boolean).join(' ');
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(tekstMowy);
    u.lang = 'pl-PL';
    u.onend = () => setCzytaGlosno(false);
    u.onerror = () => setCzytaGlosno(false);
    setCzytaGlosno(true);
    window.speechSynthesis.speak(u);
  }

  // Odrzucenie przez filtr wstępny (brak tezy, pytanie ogólne, polecenie) nie jest werdyktem merytorycznym
  // Blokada przez filtr danych osobowych ma własny nagłówek (to nie brak tezy, tylko ochrona prywatności)
  const daneOsobowe = Boolean(wynik.metadane?.dane_osobowe);
  if (odrzucone) {
    return (
      <div className="wynik" ref={kontenerRef} tabIndex={-1}>
        <div className={`komunikat-doprecyzowania ${daneOsobowe ? 'komunikat-doprecyzowania--zablokowane' : ''}`} role="status">
          <div className="werdykt__etykieta">{daneOsobowe ? 'Ochrona prywatności' : 'Wymaga doprecyzowania'}</div>
          <div className="komunikat-doprecyzowania__tytul">{daneOsobowe ? 'Zablokowano: dane osobowe' : 'Nie znaleziono tezy do weryfikacji'}</div>
          <p className="komunikat-doprecyzowania__opis">{dem.glowna_odpowiedz}</p>
        </div>

        <PodgladZgloszenia zgloszenie={zgloszenie} />

        {flagiBezpieczenstwa.length > 0 && (
          <ul className="alert-bezpieczenstwa">
            {flagiBezpieczenstwa.map((f) => <li key={f}>{f}</li>)}
          </ul>
        )}

        <div className="akcje">
          {onPopraw && (
            <button className="przycisk-drugi przycisk-drugi--glowny" onClick={onPopraw}>
              Popraw treść
            </button>
          )}
          <button className="przycisk-drugi" onClick={onOdNowa}>
            <Ikona nazwa="odswiez" rozmiar={16} />
            Nowe sprawdzenie
          </button>
        </div>
        {czas != null && <p className="czas">Sprawdzono w {Math.round(czas / 1000)} s</p>}
      </div>
    );
  }

  return (
    <div className="wynik" ref={kontenerRef} tabIndex={-1}>
      <ZrodloZgloszenia zrodlo={wynik.zrodlo_zgloszenia} />
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
            <div className="werdykt__etykieta">{niedostepne ? 'Informacja techniczna' : 'Werdykt'}</div>
            <div className="werdykt__nazwa">{nazwa}</div>
            <div className="werdykt__opis">{w.opis}</div>
          </div>

          {!niedostepne && <SilaDowodow poziom={glowneTwierdzenie?.sila_dowodow} metoda={glowneTwierdzenie?.metoda} />}

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

          {(glowneTwierdzenie?.claim || dem.glowny_kontekst_twierdzenie) ? (
            <div className="twierdzenie-glowne">
              <div className="twierdzenie-glowne__etykieta">Sprawdzane twierdzenie</div>
              <p>„{glowneTwierdzenie?.claim || dem.glowny_kontekst_twierdzenie}”</p>
            </div>
          ) : (
            <PodgladZgloszenia zgloszenie={zgloszenie} />
          )}

          {(glowneTwierdzenie?.uzasadnienie || dem.glowna_odpowiedz) && (
            <p className="wyjasnienie">{glowneTwierdzenie?.uzasadnienie || dem.glowna_odpowiedz}</p>
          )}

          {nazwa === 'Brak wystarczających dowodów' && !niedostepne && luki.length > 0 && (
            <div className="luki-glowne">
              <div className="luki-glowne__tytul">Czego nie udało się ustalić</div>
              <ul>{luki.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}

          {glowneZrodla.length > 0 && (
            <>
              <h2 className="podtytul">Źródła</h2>
              <ul className="zrodla">
                {glowneZrodla.map((z) => <Zrodlo key={z.url || z.title} zrodlo={z} />)}
              </ul>
            </>
          )}

          <DowodyCytaty dowody={glowneTwierdzenie?.ocena_dowodow} />

          {watki[0] && <Szczegoly szczegoly={watki[0].szczegoly} />}
        </>
      )}

      {flagiBezpieczenstwa.length > 0 && (
        <ul className="alert-bezpieczenstwa">
          {flagiBezpieczenstwa.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}

      {ostrzezenia.length > 0 && (
        <ul className="ostrzezenia">
          {ostrzezenia.map((o) => <li key={o}>{o}</li>)}
        </ul>
      )}

      <PetlaInformacji wynik={wynik} />

      <NotatkaResearchu research={wynik.research} />

      {wynik.model1?.tekst && (
        <>
          <button className="rozwin" onClick={() => setPokazOdczyt((p) => !p)} aria-expanded={pokazOdczyt}>
            <span className={`rozwin__strzalka ${pokazOdczyt ? 'rozwin__strzalka--otwarta' : ''}`}>
              <Ikona nazwa="strzalka" rozmiar={16} />
            </span>
            Pełna odczytana treść
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
        {obslugaMowy && (
          <button className="przycisk-drugi" onClick={odsluchaj} aria-pressed={czytaGlosno}>
            <Ikona nazwa="glosnik" rozmiar={16} />
            {czytaGlosno ? 'Zatrzymaj' : 'Odsłuchaj'}
          </button>
        )}
        <button className="przycisk-drugi" onClick={() => pobierzRaportJson(wynik, zgloszenie)}>
          <Ikona nazwa="pobierz" rozmiar={16} />
          JSON
        </button>
        <button className="przycisk-drugi" onClick={() => pobierzRaportCsv(wynik)}>
          <Ikona nazwa="pobierz" rozmiar={16} />
          CSV
        </button>
        {onPopraw && (
          <button className="przycisk-drugi" onClick={onPopraw}>
            Popraw treść
          </button>
        )}
        <button className="przycisk-drugi przycisk-drugi--glowny" onClick={onOdNowa}>
          <Ikona nazwa="odswiez" rozmiar={16} />
          Nowe sprawdzenie
        </button>
      </div>
      {czas != null && <p className="czas">Sprawdzono w {Math.round(czas / 1000)} s</p>}
    </div>
  );
}
