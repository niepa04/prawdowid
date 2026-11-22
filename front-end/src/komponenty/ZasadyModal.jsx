import { useEffect, useState } from 'react';
import Ikona from './Ikona.jsx';
import { pobierzStatus } from '../api.js';

// Okno z informacjami o źródłach, zasadach działania AI i prywatności.
export default function ZasadyModal({ otwarte, onZamknij, liczbaHistorii, onWyczyscHistorie }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!otwarte) return;
    let aktywny = true;
    pobierzStatus().then((dane) => {
      if (aktywny && dane) setStatus(dane);
    });
    const naKlawisz = (e) => {
      if (e.key === 'Escape') onZamknij();
    };
    window.addEventListener('keydown', naKlawisz);
    return () => {
      aktywny = false;
      window.removeEventListener('keydown', naKlawisz);
    };
  }, [otwarte, onZamknij]);

  if (!otwarte) return null;

  const aktywne = status?.zrodla_oficjalne?.aktywne;
  const lacznie = status?.zrodla_oficjalne?.lacznie;

  return (
    <div className="nakladka" role="dialog" aria-modal="true" aria-labelledby="zasady-tytul" onClick={onZamknij}>
      <div className="okno-zasad" onClick={(e) => e.stopPropagation()}>
        <div className="okno-zasad__gora">
          <h2 id="zasady-tytul">Źródła, zasady i prywatność</h2>
          <button type="button" className="przycisk-maly" onClick={onZamknij} aria-label="Zamknij okno">
            <Ikona nazwa="x" rozmiar={16} />
            Zamknij
          </button>
        </div>

        <div className="okno-zasad__tresc">
          <section>
            <h3>Skąd Koma bierze informacje</h3>
            <p>
              System porównuje zgłoszenia z oficjalnymi komunikatami instytucji publicznych
              (m.in. gov.pl, MSZ Odyseusz, RSO, RCB, PAA, GIOŚ, CERT Polska) oraz bazami niezależnych
              organizacji fact-checkingowych (m.in. Demagog, Google Fact Check Tools).
              {aktywne != null && lacznie != null && (
                <> Aktywne źródła w katalogu serwera: <strong>{aktywne} / {lacznie}</strong>.</>
              )}
            </p>
          </section>

          <section>
            <h3>Jak działa model i gdzie są granice</h3>
            <p>
              Model językowy pomaga zrozumieć pytanie, odczytać tekst ze zrzutów (OCR) i zestawić
              materiały, ale każda ocena opiera się na odnalezionych źródłach. Jeśli dowodów brakuje
              albo są sprzeczne, Koma wstrzymuje się od rozstrzygnięcia.
            </p>
          </section>

          <section>
            <h3>Bezpieczeństwo i prywatność sesji</h3>
            <p>
              Zgłoszenia są izolowane od instrukcji systemowych (ochrona przed prompt injection),
              a dane osobowe są blokowane przed dalszą analizą. Zanonimizowane pytania bez danych
              osobowych zasilają w tle radar trendów, aby wykrywać masowe fale dezinformacji
              i niepokoju społecznego bez spowalniania odpowiedzi.
            </p>
            {liczbaHistorii > 0 && (
              <button
                type="button"
                className="przycisk-maly"
                onClick={() => {
                  onWyczyscHistorie();
                }}
              >
                Usuń historię sesji ({liczbaHistorii})
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
