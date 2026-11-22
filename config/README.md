# config/ – wymienne części Komy

| Plik | Co zmieniasz |
|---|---|
| `modele.js` | modele AI (Ollama): nazwy, adres serwera, parametry każdego zadania |
| `ustawienia.js` | port, limity czasu, liczba tez i pytań badawczych, długość artykułu |
| `prompty/*.js` | prompty systemowe modeli |
| `zrodla/zrodla_oficjalne.json` | katalog zaufanych źródeł |
| `zrodla/mapa_tematow.json` | które źródła pytać o który temat |
| `zrodla/fact_checkerzy.json` | zaufani fact-checkerzy, Google Fact Check Tools API |

Zmienne w pliku `.env` mają pierwszeństwo przed wartościami domyślnymi (np. `OLLAMA_URL`, `KOMA_MODEL`).
Opis wszystkiego: [docs/konfiguracja.md](../docs/konfiguracja.md).

Po zmianie promptu albo modelu uruchom testy: `npm test` i `npm run test:werdykty -- --szybki`.
