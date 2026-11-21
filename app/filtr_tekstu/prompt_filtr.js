// prompt_filtr.js - prompt dla modelu filtrującego (qwen)
//
// Gdy w treści nie ma nic na temat, model ma zwrócić dokładnie BRAK_INFORMACJI,
// a filtrTekstu traktuje to jako pustą sekcję.

const BRAK_INFORMACJI = '[BRAK]';

function promptFiltra(temat, tresc) {
  return `Przefiltruj dokładnie informacje podane poniżej tak, aby dotyczyły tylko podanego tematu.

TEMAT: '${temat}'

ZASADY:
1. Zostaw wyłącznie zdania i fakty, które dotyczą tematu. Wszystko inne usuń.
2. Przepisuj zostawione informacje wiernie, tymi samymi słowami co w treści. Nie streszczaj, nie oceniaj, czy są prawdziwe, i nie dopisuj niczego od siebie.
3. Nie dodawaj wstępu, podsumowania, komentarzy ani informacji o tym, co zostało usunięte.
4. Pisz zwykłym tekstem: bez nagłówków, pogrubień i innego formatowania Markdown. Każdą informację zapisz w osobnej linii.
5. Jeśli żadna informacja nie dotyczy tematu, zwróć dokładnie: ${BRAK_INFORMACJI}

TREŚĆ:
${tresc}`;
}

module.exports = { promptFiltra, BRAK_INFORMACJI };
