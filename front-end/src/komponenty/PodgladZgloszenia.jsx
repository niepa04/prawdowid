import { useState } from 'react';

const LIMIT_PODGLADU = 260;

// Pokazuje wysłane przez użytkownika zgłoszenie (tekst i miniatury zdjęć),
// żeby w trakcie sprawdzania lub po wyniku nie znikało z ekranu.
export default function PodgladZgloszenia({ zgloszenie, etykieta = 'Twoje zgłoszenie' }) {
  const [rozwiniete, setRozwiniete] = useState(false);
  if (!zgloszenie) return null;

  const tekst = (zgloszenie.tekst || '').trim();
  const zdjecia = zgloszenie.zdjecia || [];
  if (!tekst && !zdjecia.length) return null;

  const zaDlugi = tekst.length > LIMIT_PODGLADU;
  const widocznyTekst = zaDlugi && !rozwiniete ? `${tekst.slice(0, LIMIT_PODGLADU).trimEnd()}…` : tekst;

  return (
    <div className="podglad">
      <div className="podglad__etykieta">{etykieta}</div>
      {tekst && <p className="podglad__tekst">{widocznyTekst}</p>}
      {zaDlugi && (
        <button type="button" className="podglad__wiecej" onClick={() => setRozwiniete((r) => !r)}>
          {rozwiniete ? 'Zwiń' : 'Pokaż całość'}
        </button>
      )}
      {zdjecia.length > 0 && (
        <div className="podglad__zdjecia">
          {zdjecia.map((z) => (
            <span key={z.id} className="kafelek kafelek--zdjecie" title={z.nazwa}>
              <img src={z.dataUrl} alt="" className="kafelek__miniatura" />
              {z.nazwa.length > 20 ? `${z.nazwa.slice(0, 18)}…` : z.nazwa}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
