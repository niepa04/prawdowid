import { useEffect } from 'react';
import Ikona from './Ikona.jsx';

// Prosty podgląd powiększonego zdjęcia po kliknięciu miniatury.
export default function PodgladObrazu({ obraz, onZamknij }) {
  useEffect(() => {
    if (!obraz) return;
    const naKlawisz = (e) => {
      if (e.key === 'Escape') onZamknij();
    };
    window.addEventListener('keydown', naKlawisz);
    return () => window.removeEventListener('keydown', naKlawisz);
  }, [obraz, onZamknij]);

  if (!obraz) return null;

  return (
    <div className="nakladka" role="dialog" aria-modal="true" aria-label={`Podgląd obrazu ${obraz.nazwa}`} onClick={onZamknij}>
      <div className="okno-obrazu" onClick={(e) => e.stopPropagation()}>
        <div className="okno-obrazu__gora">
          <span>{obraz.nazwa}</span>
          <button type="button" className="przycisk-maly" onClick={onZamknij} aria-label="Zamknij podgląd">
            <Ikona nazwa="x" rozmiar={16} />
            Zamknij
          </button>
        </div>
        <img src={obraz.dataUrl} alt={obraz.nazwa} className="okno-obrazu__img" />
      </div>
    </div>
  );
}
