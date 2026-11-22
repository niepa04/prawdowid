import { useEffect, useState } from 'react';
import Ikona from './Ikona.jsx';
import PodgladZgloszenia from './PodgladZgloszenia.jsx';

// Etapy pokazywane podczas sprawdzania. Serwer nie raportuje jeszcze postępu,
// więc etapy przechodzą po szacowanym czasie, a ostatni trwa, dopóki nie przyjdzie odpowiedź.
function etapy({ linki, zdjecia }) {
  return [
    { nazwa: 'Przygotowanie zgłoszenia', czas: 1500 },
    zdjecia.length > 0 && { nazwa: `Odczytywanie tekstu ze ${zdjecia.length === 1 ? 'zdjęcia' : 'zdjęć'}`, czas: 8000 * zdjecia.length },
    linki.length > 0 && { nazwa: `Pobieranie ${linki.length === 1 ? 'strony z linku' : 'stron z linków'}`, czas: 4000 },
    { nazwa: 'Wybieranie najważniejszych informacji', czas: 6000 },
    { nazwa: 'Wyodrębnianie twierdzeń do sprawdzenia', czas: 10000 },
    { nazwa: 'Szukanie dowodów w źródłach', czas: 15000 },
    { nazwa: 'Przygotowanie werdyktu', czas: Infinity },
  ].filter(Boolean);
}

export default function Sprawdzanie({ zgloszenie, onAnuluj }) {
  const [lista] = useState(() => etapy(zgloszenie));
  const [aktualny, setAktualny] = useState(0);
  const [sekundy, setSekundy] = useState(0);

  useEffect(() => {
    const czas = lista[aktualny]?.czas;
    if (!Number.isFinite(czas)) return;
    const t = setTimeout(() => setAktualny((a) => a + 1), czas);
    return () => clearTimeout(t);
  }, [aktualny, lista]);

  useEffect(() => {
    const t = setInterval(() => setSekundy((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // pasek dochodzi do 90%, ostatnie 10% po odpowiedzi serwera
  const procent = Math.round((aktualny / (lista.length - 1)) * 90);

  return (
    <div className="sprawdzanie" aria-live="polite">
      <PodgladZgloszenia zgloszenie={zgloszenie} etykieta="Sprawdzane zgłoszenie" />
      <div className="postep">
        <div className="postep__pasek" style={{ width: `${procent}%` }} />
      </div>
      <ol className="etapy">
        {lista.map(({ nazwa }, i) => {
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
      <div className="sprawdzanie__dol">
        <span>Czas: {sekundy} s · Zwykle zajmuje to kilkadziesiąt sekund.</span>
        <button className="przycisk-maly" onClick={onAnuluj}>Anuluj</button>
      </div>
    </div>
  );
}
