<p align="center"><img src="front-end/src/assets/logo-znak.png" alt="Koma" width="88"></p>
<h1 align="center">Koma</h1>
<p align="center"><b>K</b>atalog <b>O</b>biektywnych <b>M</b>ateriałów i <b>A</b>naliz · Sprawdź, zanim udostępnisz.<br>Zespół: <b>Drużyna</b> · HackNation 2026 · zadanie MSZ „Prawdowid”</p>

Koma sprawdza tekst, link albo zrzut ekranu w oficjalnych źródłach i u fact-checkerów. Dla każdej tezy zwraca werdykt (Potwierdzone, Fałszywe, Wprowadzające w błąd, Brak wystarczających dowodów, Nie podlega weryfikacji), uzasadnienie, siłę podstawy i cytaty ze źródeł (tytuł, wydawca, data, link). Gdy brak dowodów, uczciwie się wstrzymuje. Awaria nigdy nie jest werdyktem.

## Kanały
- **WWW** (React, responsywna, tryb A+, odsłuch wyniku): tekst, link, zdjęcie (OCR).
- **Rozszerzenie przeglądarki**: zaznacz tekst lub kliknij obraz prawym przyciskiem → „Weryfikuj w Koma”.

Oba kanały korzystają z tego samego API (`POST /api/weryfikuj`).

## Architektura
`Zgłoszenie → ekstrakcja (tekst, strona, OCR) → filtr danych osobowych → filtr wstępny → research (40 źródeł urzędowych + Google Fact Check API) → Weryfikator Prawdy → werdykt + źródła`

- Model rozumie pytanie i porównuje materiały, a reguły w kodzie pilnują werdyktu: cytat musi być w materiale, a liczby muszą się zgadzać.
- Modele lokalne w Ollamie: `qwen3.5:9b` (analiza), `glm-ocr` (OCR). Model i dostawcę zmienia się w `config/` bez zmian w kodzie.
- Źródła, kryteria i prompty są jawne w [`config/`](config). Lista źródeł jest też na stronie, w zakładce „Zaufane źródła”.

## Uruchomienie
Wymagania: Node.js 22+, Ollama z powyższymi modelami.
```bash
npm install && npm install --prefix front-end
cp .env.example .env   # klucz Google Fact Check (opcjonalny), adres Ollamy
npm run build && npm start   # http://localhost:3000
```
Rozszerzenie: `chrome://extensions` → „Załaduj rozpakowane” → folder `extension/`.

## Testy
`npm test` uruchamia testy jednostkowe. `node tests/test_werdyktow.js [--szybki]` liczy mierniki z sekcji 6: 100 zgłoszeń (20 tematów × 5 sformułowań), prompt injection, spójność kanałów. Raporty trafiają do `tests/raporty/`.

Ostatnia próba (szybka): czas mediana **26,5 s**, pokrycie cytowań **100%**, odporność **100%**, end-to-end **100%**, spójność kanałów **100%**, **2,9** wywołania LLM i ok. **6,3 tys.** tokenów na zapytanie.

## Koszt i ruch (szacunek)
- **1 000 zapytań ≈ 10–40 zł**: ok. 8 h pracy GPU przy ~30 s na zapytanie (prąd własnego GPU albo wynajem chmurowego). Google Fact Check API jest bezpłatne w limicie, użytkownik nic nie płaci.
- **Duży ruch:** jedna instancja Ollamy obsłuży ok. 100–150 zapytań/h, bo zapytania czekają w kolejce. Przy większym ruchu rośnie czas, a po 8 min użytkownik dostaje komunikat o niedostępności (nie werdykt). Skalowanie to kolejne instancje Ollamy, cache wyników i limit zapytań na IP.

## Ryzyka
| Ryzyko | Ograniczenie |
|---|---|
| Halucynacje | werdykt tylko z cytatem obecnym w materiale, reguły w kodzie |
| Stronniczość źródeł | wiele typów źródeł, jawne kryteria, domena nie przesądza o werdykcie |
| Prywatność | PESEL, adresy itp. blokowane przed analizą; modele lokalne |
| Prompt injection | prompt systemowy oddzielony od danych, skan stron, walidacja odpowiedzi |
| Dostępność | jasny komunikat o awarii, brak klucza ≠ wynik |
| Nadużycia | filtr spamu i tematów; limit zapytań planowany |

Znane ograniczenia: brak wyszukiwania odwrotnego obrazu i nagrań; trafność zależy od pokrycia źródeł.

## Dokumentacja
[Architektura](docs/architektura.md) · [Uruchomienie](docs/uruchomienie.md) · [Konfiguracja](docs/konfiguracja.md) · [Werdykty i źródła](docs/werdykty_i_zrodla.md) · [API](docs/api.md) · [Bezpieczeństwo](docs/bezpieczenstwo.md) · [Testy](docs/testy.md)
