// Przykładowy wynik do podglądu wyglądu. Do zastąpienia odpowiedzią z /api/weryfikuj.
export const PRZYKLADOWY_WYNIK = {
  werdykt: 'czesciowo', // prawda | czesciowo | manipulacja | falsz
  wyjasnienie:
    'Unijny zakaz dotyczy sprzedaży nowych aut spalinowych od 2035 roku, a nie poruszania się nimi po miastach od 2027.',
  zrodla: [
    { tytul: 'Zakaz aut spalinowych w miastach od 2027?', ocena: 'falsz', url: '#' },
    { tytul: 'Co naprawdę oznacza unijny zakaz sprzedaży aut spalinowych', ocena: 'prawda', url: '#' },
  ],
  odczytano: {
    tekst: 'Słyszałem, że od 2027 będzie zakaz aut spalinowych w miastach.',
    linki: 'Parlament Europejski przyjął przepisy, zgodnie z którymi od 2035 roku nowe samochody osobowe sprzedawane w UE nie będą mogły emitować CO2.',
    zdjecia: 'OD 2027 ZAKAZ WJAZDU AUT SPALINOWYCH DO MIAST!',
  },
};
