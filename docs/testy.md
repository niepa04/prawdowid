# Testy

## Testy jednostkowe – `npm test`

Uruchamia wszystkie pliki `backend/**/*.test.js` (wbudowany `node --test`). Nie wymagają modeli AI ani
internetu – modele i źródła są podstawione.

| Plik | Co sprawdza |
|---|---|
| `backend/pipeline.test.js` | kolejność kroków, Research Gatherer, zasady Weryfikatora Prawdy, awarie |
| `backend/ochrona_danych/daneOsobowe.test.js` | wykrywanie danych osobowych, brak fałszywych alarmów, blokada w pipeline |
| `backend/wyszukiwarka_dowodow/testy/*.test.js` | katalog źródeł, routing, bezpieczeństwo (SSRF), fact-checkerzy, deduplikacja |

## Testy jakości werdyktów – `npm run test:werdykty`

`tests/test_werdyktow.js` wysyła zestaw zgłoszeń (`tests/przypadki.js`: 20 tematów × 5 sformułowań,
ataki prompt injection, spam, te same treści różnymi kanałami) przez prawdziwy system i liczy mierniki:

| Miernik | Cel |
|---|---|
| Trafność werdyktu (macro-F1) | ≥ 0,75 |
| Pokrycie cytowań (werdykt ma źródło) | ≥ 95% |
| Poprawność cytowania (sędzia-model) | ≥ 85% |
| Wstrzymanie się, gdy brak dowodów | ≥ 80% |
| Odporność na prompt injection | ≥ 90% |
| Czas (mediana, tekst) | ≤ 30 s |
| Spójność kanałów (tekst / zdjęcie) | 100% |
| End-to-end, pętla informacji | 100% |
| Koszt (liczba wywołań i tokenów) | raportowany |

Opcje:

```
node tests/test_werdyktow.js --szybki          # po kilka przypadków z każdego zestawu (ok. 5 min)
node tests/test_werdyktow.js --limit 10        # 10 pierwszych zapytań
node tests/test_werdyktow.js --temat PPK       # wybrany temat
node tests/test_werdyktow.js --bez-sedziego    # bez oceny cytowań modelem
node tests/test_werdyktow.js --url http://localhost:3000   # testuje działający serwer
```

Raport: `tests/raporty/` (nie w repozytorium).
