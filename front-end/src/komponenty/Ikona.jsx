// Proste ikony liniowe, żeby nie dokładać biblioteki
const SCIEZKI = {
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1 M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  zdjecie: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9h.01',
  plus: 'M12 5v14 M5 12h14',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  kopiuj: 'M8 8h11v11H8z M5 16V5h11',
  udostepnij: 'M12 4v11 M7 9l5-5 5 5 M5 15v4h14v-4',
  odswiez: 'M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6',
  strzalka: 'M6 9l6 6 6-6',
  plik: 'M7 3h7l5 5v13H7z M14 3v5h5',
  zewnetrzny: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  lupa: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M15.5 15.5L20 20',
  tarcza: 'M12 3l7 3v6c0 4-3 7.5-7 9c-4-1.5-7-5-7-9V6z M9 12l2 2 4-4',
};

export default function Ikona({ nazwa, rozmiar = 18 }) {
  return (
    <svg
      width={rozmiar}
      height={rozmiar}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={SCIEZKI[nazwa]} />
    </svg>
  );
}
