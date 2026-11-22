import { useCallback, useEffect, useState } from 'react';
import Ikona from './Ikona.jsx';
import {
  pobierzAlerty,
  pobierzSzczegolyKlastra,
  zmienStatusAlertu,
  wymusAnalizeMonitoringu,
} from '../api.js';
import { werdykt } from '../werdykty.js';
import { odmiana } from '../odmiana.js';

const ETYKIETY_KATEGORII = {
  bezpieczenstwo_militarne: 'Bezpieczeństwo i obronność',
  zagrozenia_kryzysowe: 'Zagrożenia kryzysowe',
  cyberbezpieczenstwo: 'Cyberbezpieczeństwo',
  zdrowie: 'Zdrowie publiczne',
  infrastruktura_transport: 'Infrastruktura i transport',
  gospodarka_finanse: 'Gospodarka i finanse',
  polityka_dezinformacja: 'Polityka i dezinformacja',
  inne: 'Inne tematy',
};

const ETYKIETY_POZIOMU = {
  krytyczna: 'Krytyczna nadaktywność',
  wysoka: 'Wysoka nadaktywność',
  podwyzszona: 'Podwyższona aktywność',
};

const ETYKIETY_RYZYKA = {
  wysokie: 'Wysokie ryzyko dezinformacji',
  srednie: 'Średnie ryzyko dezinformacji',
  niskie: 'Niskie ryzyko dezinformacji',
};

const ETYKIETY_METODY = {
  dokladny_hash: 'Identyczne pytanie (O(1))',
  model_llm: 'Grupowanie AI (qwen3.5:9b)',
  heurystyka: 'Dopasowanie rdzeniowe',
  nowy_klaster: 'Nowy temat',
};

function formatujCzas(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RozkladWerdyktow({ rozklad }) {
  const wpisy = Object.entries(rozklad || {}).filter(([, ile]) => ile > 0);
  if (!wpisy.length) return null;
  const suma = wpisy.reduce((s, [, ile]) => s + ile, 0) || 1;
  return (
    <div className="radar-werdykty">
      <div className="radar-werdykty__pasek" aria-hidden="true">
        {wpisy.map(([nazwa, ile]) => {
          const kl = nazwa === 'W trakcie analizy' ? 'brak' : werdykt(nazwa).klasa;
          return (
            <span
              key={nazwa}
              className={`radar-werdykty__segment radar-werdykty__segment--${kl}`}
              style={{ width: `${Math.max(4, (ile / suma) * 100)}%` }}
              title={`${nazwa}: ${ile}`}
            />
          );
        })}
      </div>
      <div className="radar-werdykty__legenda">
        {wpisy
          .sort((a, b) => b[1] - a[1])
          .map(([nazwa, ile]) => {
            const kl = nazwa === 'W trakcie analizy' ? 'brak' : werdykt(nazwa).klasa;
            return (
              <span key={nazwa} className={`plakietka plakietka--${kl}`}>
                {nazwa}: {ile}
              </span>
            );
          })}
      </div>
    </div>
  );
}

function SzczegolyWariantow({ klasterId }) {
  const [dane, setDane] = useState(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [blad, setBlad] = useState('');

  useEffect(() => {
    let aktywny = true;
    setLadowanie(true);
    pobierzSzczegolyKlastra(klasterId)
      .then((res) => {
        if (aktywny) {
          setDane(res);
          setBlad('');
        }
      })
      .catch((err) => {
        if (aktywny) setBlad(err.message);
      })
      .finally(() => {
        if (aktywny) setLadowanie(false);
      });
    return () => {
      aktywny = false;
    };
  }, [klasterId]);

  if (ladowanie) return <p className="radar-warianty__stan">Wczytujemy pogrupowane sformułowania z bazy…</p>;
  if (blad) return <p className="radar-warianty__stan">{blad}</p>;
  if (!dane?.warianty?.length) return <p className="radar-warianty__stan">Brak zapisanych wariantów pytań.</p>;

  return (
    <div className="radar-warianty">
      <div className="radar-warianty__naglowek">
        Pogrupowane warianty pytań użytkowników ({dane.warianty.length})
      </div>
      <ul className="radar-warianty__lista">
        {dane.warianty.map((w, i) => (
          <li key={`${w.tekst}-${i}`} className="radar-wariant">
            <div className="radar-wariant__gora">
              <span className="radar-wariant__tekst">„{w.tekst}”</span>
              <span className="radar-wariant__liczba">{w.liczba_zgloszen} ×</span>
            </div>
            <div className="radar-wariant__meta">
              <span>{ETYKIETY_METODY[w.metoda_grupowania] || w.metoda_grupowania || 'Grupowanie'}</span>
              {w.srednia_pewnosc != null && <span>Pewność: {Math.round(w.srednia_pewnosc * 100)}%</span>}
              {w.ostatni_werdykt && (
                <span className={`plakietka plakietka--${werdykt(w.ostatni_werdykt).klasa}`}>
                  {w.ostatni_werdykt}
                </span>
              )}
              <span>Ostatnio: {formatujCzas(w.ostatnie_at)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RadarAlertow({ onZmianaAlertow }) {
  const [dane, setDane] = useState(null);
  const [filtrStatusu, setFiltrStatusu] = useState('aktywne_i_monitorowane');
  const [ladowanie, setLadowanie] = useState(true);
  const [analizaTrwa, setAnalizaTrwa] = useState(false);
  const [blad, setBlad] = useState('');
  const [otwartyKlasterId, setOtwartyKlasterId] = useState(null);

  const odswiez = useCallback(async () => {
    try {
      const res = await pobierzAlerty({ status: filtrStatusu, limit: 50 });
      setDane(res);
      setBlad('');
      onZmianaAlertow?.(res?.podsumowanie?.aktywne_alerty || 0);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLadowanie(false);
    }
  }, [filtrStatusu, onZmianaAlertow]);

  useEffect(() => {
    setLadowanie(true);
    odswiez();
    const timer = setInterval(odswiez, 15000);
    return () => clearInterval(timer);
  }, [odswiez]);

  async function uruchomAnalizeTla() {
    setAnalizaTrwa(true);
    try {
      await wymusAnalizeMonitoringu();
      await odswiez();
    } catch (err) {
      setBlad(err.message);
    } finally {
      setAnalizaTrwa(false);
    }
  }

  async function ustawStatus(alertId, status) {
    try {
      await zmienStatusAlertu(alertId, status);
      await odswiez();
    } catch (err) {
      setBlad(err.message);
    }
  }

  const podsumowanie = dane?.podsumowanie || {};
  const kolejka = dane?.kolejka || {};
  const alerty = dane?.alerty || [];
  const klastry = dane?.klastry || [];

  return (
    <section className="radar" aria-label="System wczesnego ostrzegania i grupowania tematów">
      <div className="radar__gora">
        <div>
          <h2 className="radar__tytul">Radar tematów i wczesne ostrzeganie</h2>
          <p className="radar__opis">
            Moduł działa w tle poza ścieżką odpowiedzi użytkownika. Semantycznie grupuje podobne
            pytania w bazie danych, wychwytuje nagłe fale niepokoju społecznego i zestawia je z
            twardym bilansem weryfikacji KOMA — pokazując skalę obaw bez tworzenia dezinformacji.
          </p>
        </div>
        <div className="radar__akcje-gora">
          <button type="button" className="przycisk-maly" onClick={odswiez} disabled={ladowanie}>
            <Ikona nazwa="odswiez" rozmiar={15} />
            Odśwież
          </button>
          <button
            type="button"
            className="przycisk-maly"
            onClick={uruchomAnalizeTla}
            disabled={analizaTrwa}
          >
            <Ikona nazwa="radar" rozmiar={15} />
            {analizaTrwa ? 'Analizujemy kolejkę…' : 'Przelicz kolejkę tła'}
          </button>
        </div>
      </div>

      <div className="radar-zastrzezenie" role="note">
        <strong>Zasada antydezinformacyjna:</strong> liczby poniżej odzwierciedlają wyłącznie{' '}
        <em>zapytania kierowane przez użytkowników</em> (czego ludzie się obawiają lub co chcą sprawdzić),
        a nie potwierdzone zdarzenia. Zawsze sprawdzaj bilans werdyktów KOMA obok każdego alertu.
      </div>

      <div className="radar-kpi">
        <div className="radar-kpi__karta">
          <span className="radar-kpi__etykieta">Zgłoszenia dziś</span>
          <strong className="radar-kpi__wartosc">{podsumowanie.zgloszenia_dzis ?? 0}</strong>
          <span className="radar-kpi__pod">Łącznie w bazie: {podsumowanie.zgloszenia_lacznie ?? 0}</span>
        </div>
        <div className="radar-kpi__karta">
          <span className="radar-kpi__etykieta">Ostatnia godzina</span>
          <strong className="radar-kpi__wartosc">{podsumowanie.zgloszenia_godzina ?? 0}</strong>
          <span className="radar-kpi__pod">
            Kolejka tła: {kolejka.oczekuje || 0} oczek. · {kolejka.pracuje ? 'pracuje' : 'gotowa'}
          </span>
        </div>
        <div className="radar-kpi__karta radar-kpi__karta--alert">
          <span className="radar-kpi__etykieta">Aktywne alerty</span>
          <strong className="radar-kpi__wartosc">{podsumowanie.aktywne_alerty ?? 0}</strong>
          <span className="radar-kpi__pod">Wykryte skoki zainteresowania</span>
        </div>
        <div className="radar-kpi__karta">
          <span className="radar-kpi__etykieta">Grupy tematyczne</span>
          <strong className="radar-kpi__wartosc">{podsumowanie.liczba_klastrow ?? 0}</strong>
          <span className="radar-kpi__pod">Klastry semantyczne AI</span>
        </div>
      </div>

      {blad && (
        <div className="ostrzezenia" role="alert">
          {blad}
        </div>
      )}

      <div className="radar-sekcja-naglowek">
        <h3>Alerty podejrzanej nadaktywności</h3>
        <div className="radar-filtry" role="group" aria-label="Filtr statusu alertów">
          {[
            ['aktywne_i_monitorowane', 'Bieżące'],
            ['aktywny', 'Aktywne'],
            ['monitorowany', 'Monitorowane'],
            ['zamkniety', 'Zamknięte'],
            ['wszystkie', 'Wszystkie'],
          ].map(([klucz, etykieta]) => (
            <button
              key={klucz}
              type="button"
              className={`przyklad ${filtrStatusu === klucz ? 'radar-filtr--aktywny' : ''}`}
              onClick={() => setFiltrStatusu(klucz)}
            >
              {etykieta}
            </button>
          ))}
        </div>
      </div>

      {ladowanie && !dane ? (
        <p className="radar-pusto">Wczytujemy dane monitoringu…</p>
      ) : alerty.length === 0 ? (
        <div className="radar-pusto">
          <strong>Brak alertów nadaktywności w wybranym widoku.</strong>
          <p>
            Gdy pojawi się nagła fala podobnych zapytań (przekroczenie progu godzinowego, dziennego
            lub skok względem średniej z poprzednich dni), system wygeneruje tutaj podsumowanie
            sytuacyjne dla analityków i instytucji.
          </p>
        </div>
      ) : (
        <ol className="radar-alerty">
          {alerty.map((a) => {
            const otwarty = otwartyKlasterId === a.klaster_id;
            return (
              <li key={a.id} className={`radar-alert radar-alert--${a.poziom}`}>
                <div className="radar-alert__gora">
                  <div className="radar-alert__znaczniki">
                    <span className={`radar-badge radar-badge--${a.poziom}`}>
                      {ETYKIETY_POZIOMU[a.poziom] || a.poziom}
                    </span>
                    <span className="radar-badge radar-badge--neutralny">
                      {ETYKIETY_KATEGORII[a.kategoria] || a.kategoria || 'Temat'}
                    </span>
                    <span className={`radar-badge radar-badge--ryzyko-${a.ocena_ryzyka_dezinformacji}`}>
                      {ETYKIETY_RYZYKA[a.ocena_ryzyka_dezinformacji] || a.ocena_ryzyka_dezinformacji}
                    </span>
                    <span className="radar-badge radar-badge--status">Status: {a.status_alertu}</span>
                  </div>
                  <span className="radar-alert__czas">Zaktualizowano: {formatujCzas(a.zaktualizowano_at)}</span>
                </div>

                <h4 className="radar-alert__tytul">{a.naglowek_alertu}</h4>
                <p className="radar-alert__powod">{a.powod_wykrycia}</p>

                <div className="radar-alert__metryki">
                  <span><strong>{a.liczba_dzis}</strong> {odmiana(a.liczba_dzis, 'zgłoszenie', 'zgłoszenia', 'zgłoszeń')} dziś</span>
                  <span><strong>{a.liczba_godzina}</strong> w ostatniej godz.</span>
                  <span><strong>{a.liczba_calkowita}</strong> łącznie w klastrze</span>
                  <span>Wzrost: <strong>×{a.wskaznik_wzrostu}</strong></span>
                </div>

                <div className="radar-alert__analiza">
                  <div className="radar-alert__etykieta">Ocena sytuacyjna („oczami obywateli”)</div>
                  <p>{a.podsumowanie_sytuacyjne}</p>
                  {a.obawy_spoleczne?.length > 0 && (
                    <div className="radar-obawy">
                      {a.obawy_spoleczne.map((ob) => (
                        <span key={ob} className="radar-obawa">{ob}</span>
                      ))}
                    </div>
                  )}
                  {a.rekomendacja_komunikacyjna && (
                    <p className="radar-alert__rekomendacja">
                      <strong>Rekomendacja komunikacyjna:</strong> {a.rekomendacja_komunikacyjna}
                    </p>
                  )}
                </div>

                <RozkladWerdyktow rozklad={a.rozklad_werdyktow} />

                <div className="radar-alert__stopka">
                  <button
                    type="button"
                    className="przycisk-maly"
                    onClick={() => setOtwartyKlasterId(otwarty ? null : a.klaster_id)}
                  >
                    <Ikona nazwa="wykres" rozmiar={14} />
                    {otwarty ? 'Ukryj warianty pytań' : 'Pokaż pogrupowane warianty pytań'}
                  </button>
                  <div className="radar-alert__status-akcje">
                    {a.status_alertu !== 'monitorowany' && (
                      <button type="button" className="przyklad" onClick={() => ustawStatus(a.id, 'monitorowany')}>
                        Oznacz: monitorowany
                      </button>
                    )}
                    {a.status_alertu !== 'zamkniety' ? (
                      <button type="button" className="przyklad" onClick={() => ustawStatus(a.id, 'zamkniety')}>
                        Zamknij alert
                      </button>
                    ) : (
                      <button type="button" className="przyklad" onClick={() => ustawStatus(a.id, 'aktywny')}>
                        Wznów alert
                      </button>
                    )}
                  </div>
                </div>

                {otwarty && <SzczegolyWariantow klasterId={a.klaster_id} />}
              </li>
            );
          })}
        </ol>
      )}

      <div className="radar-sekcja-naglowek">
        <h3>Wszystkie rozpoznane grupy tematyczne ({klastry.length})</h3>
      </div>

      {klastry.length === 0 ? (
        <p className="radar-pusto">
          Brak zapisanych tematów. Po przesłaniu pytań do weryfikacji pojawią się tutaj automatycznie w tle.
        </p>
      ) : (
        <ul className="radar-klastry">
          {klastry.map((k) => {
            const otwarty = otwartyKlasterId === k.id;
            return (
              <li key={k.id} className="radar-klaster">
                <button
                  type="button"
                  className="radar-klaster__wiersz"
                  onClick={() => setOtwartyKlasterId(otwarty ? null : k.id)}
                  aria-expanded={otwarty}
                >
                  <div className="radar-klaster__info">
                    <span className="radar-klaster__tytul">{k.tytul}</span>
                    <span className="radar-klaster__pytanie">{k.kanoniczne_pytanie}</span>
                  </div>
                  <div className="radar-klaster__liczby">
                    <span className="radar-badge radar-badge--neutralny">
                      {ETYKIETY_KATEGORII[k.kategoria] || k.kategoria}
                    </span>
                    <span className="radar-klaster__licznik">
                      {k.liczba_dzis} dziś · {k.liczba_zgloszen} łącznie
                    </span>
                    {k.alert && (
                      <span className={`radar-badge radar-badge--${k.alert.poziom}`}>
                        Alert ({k.alert.status_alertu})
                      </span>
                    )}
                  </div>
                </button>
                {otwarty && <SzczegolyWariantow klasterId={k.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
