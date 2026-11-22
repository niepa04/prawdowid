// Werdykty zwracane przez Weryfikator Prawdy (backend/weryfikator/) i ich wygląd na stronie.
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
  'Nie można teraz sprawdzić': {
    klasa: 'niedostepne',
    opis: 'Wyszukiwarka źródeł jest teraz niedostępna. To nie znaczy, że nie ma na ten temat informacji – spróbuj ponownie za kilka minut.',
    skala: null,
  },
  'Zablokowano: dane osobowe': {
    klasa: 'zablokowane',
    opis: 'Nie można używać danych osobowych w zapytaniach (np. PESEL, adres zamieszkania, telefon, dane osób prywatnych). Usuń je i spróbuj ponownie.',
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

export function silaPodstawy(poziom, metoda) {
  if (poziom === 'wysoka') {
    return {
      klasa: 'wysoka',
      etykieta: 'Podstawa odpowiedzi: wysoka',
      opis: metoda === 'ocena_fact_checkera' ? 'Oparte na ocenie niezależnych fact-checkerów.' : 'Jednoznaczne potwierdzenie w źródłach.',
    };
  }
  if (poziom === 'umiarkowana') {
    return {
      klasa: 'umiarkowana',
      etykieta: 'Podstawa odpowiedzi: umiarkowana',
      opis: 'Ustalono na podstawie zebranych materiałów źródłowych.',
    };
  }
  if (poziom === 'niska') {
    return {
      klasa: 'niska',
      etykieta: 'Podstawa odpowiedzi: niska',
      opis: 'Niewystarczające lub niejednoznaczne materiały.',
    };
  }
  return null;
}

export function formatujDate(wartosc) {
  if (!wartosc) return null;
  const d = new Date(wartosc);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function czyArchiwalna(wartosc, progDni = 365) {
  if (!wartosc) return false;
  const d = new Date(wartosc);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > progDni * 24 * 60 * 60 * 1000;
}

const OPISY_FLAG = {
  prompt_injection_detected: 'W treści jednego ze źródeł wykryto próbę manipulacji instrukcjami — została zignorowana.',
  input_command_only: 'Zgłoszenie zawierało wyłącznie polecenie dla systemu zamiast informacji do sprawdzenia.',
  personal_data: 'Zgłoszenie zawierało dane osobowe – ze względu na ochronę prywatności nie zostało przekazane dalej.',
  redirect_blocked: 'Zablokowano przekierowanie poza zatwierdzoną listę źródeł.',
  search_result_untrusted_host: 'Pominięto niezweryfikowany adres spoza zatwierdzonej listy źródeł.',
};

export function opisyBezpieczenstwa(flagi) {
  if (!Array.isArray(flagi) || !flagi.length) return [];
  return [...new Set(flagi.map((f) => OPISY_FLAG[f?.type] || 'Wykryto i zablokowano potencjalną próbę manipulacji treścią.'))];
}
