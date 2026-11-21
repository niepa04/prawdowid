// Werdykty zwracane przez moduł Demagog (app/demagog/demagog.js) i ich wygląd na stronie.
// klasa = nazwa koloru w style.css, skala = miejsce na pasku (null = poza skalą)

export const WERDYKTY = {
  Potwierdzone: {
    klasa: 'prawda',
    opis: 'Sprawdzone źródła potwierdzają tę informację.',
    skala: 'Potwierdzone',
  },
  'Wprowadzające w błąd': {
    klasa: 'manipulacja',
    opis: 'Informacja zawiera prawdziwe elementy, ale przekręca fakty albo pomija ważny kontekst.',
    skala: 'Wprowadzające w błąd',
  },
  Fałszywe: {
    klasa: 'falsz',
    opis: 'Sprawdzone źródła i fact-checkerzy zaprzeczają tej informacji.',
    skala: 'Fałszywe',
  },
  'Brak wystarczających dowodów': {
    klasa: 'brak',
    opis: 'Nie znaleźliśmy dość materiałów, żeby to rozstrzygnąć. To nie znaczy, że informacja jest fałszywa.',
    skala: null,
  },
  'Nie podlega weryfikacji': {
    klasa: 'brak',
    opis: 'To opinia, ocena albo pytanie, a nie fakt, który da się sprawdzić.',
    skala: null,
  },
};

export const SKALA = ['Fałszywe', 'Wprowadzające w błąd', 'Potwierdzone'];

export function werdykt(nazwa) {
  return WERDYKTY[nazwa] || WERDYKTY['Brak wystarczających dowodów'];
}
