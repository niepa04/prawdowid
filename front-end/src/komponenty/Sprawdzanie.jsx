import { useEffect, useState } from 'react';
import Ikona from './Ikona.jsx';

// Etapy pokazywane podczas sprawdzania. Na razie przechodzą same po czasie,
// później będą podpięte pod prawdziwy postęp z serwera.
function etapy({ linki, zdjecia }) {
  return [
    'Rozdzielanie tekstu, linków i zdjęć',
    zdjecia.length > 0 && `Odczytywanie tekstu ze ${zdjecia.length === 1 ? 'zdjęcia' : 'zdjęć'}`,
    linki.length > 0 && `Pobieranie ${linki.length === 1 ? 'strony' : 'stron'} z linków`,
    'Wybieranie informacji na temat',
    'Porównywanie z bazą Demagoga',
  ].filter(Boolean);
}

const CZAS_ETAPU_MS = 900;

export default function Sprawdzanie({ zgloszenie, onKoniec }) {
  const lista = etapy(zgloszenie);
  const [aktualny, setAktualny] = useState(0);

  useEffect(() => {
    if (aktualny >= lista.length) {
      const t = setTimeout(onKoniec, 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setAktualny((a) => a + 1), CZAS_ETAPU_MS);
    return () => clearTimeout(t);
  }, [aktualny, lista.length, onKoniec]);

  const procent = Math.round((Math.min(aktualny, lista.length) / lista.length) * 100);

  return (
    <div className="sprawdzanie" aria-live="polite">
      <div className="postep">
        <div className="postep__pasek" style={{ width: `${procent}%` }} />
      </div>
      <ol className="etapy">
        {lista.map((nazwa, i) => {
          const stan = i < aktualny ? 'gotowe' : i === aktualny ? 'trwa' : 'czeka';
          return (
            <li key={nazwa} className={`etap etap--${stan}`}>
              <span className="etap__znak">
                {stan === 'gotowe' && <Ikona nazwa="check" rozmiar={14} />}
                {stan === 'trwa' && <span className="krecik" />}
              </span>
              {nazwa}
              {stan === 'trwa' && '…'}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
