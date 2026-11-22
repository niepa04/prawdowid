# Bezpieczeństwo i prywatność

## Dane osobowe

Filtr danych osobowych (`backend/ochrona_danych/daneOsobowe.js`) działa zaraz po zamianie zgłoszenia na
tekst, **zanim** cokolwiek trafi do modeli researchu i zewnętrznych wyszukiwarek.

| Wykrywane dane | Sposób |
|---|---|
| PESEL, numer dowodu osobistego, numer paszportu | wzór + suma kontrolna |
| numer konta (IBAN), numer karty płatniczej | suma kontrolna (mod 97, algorytm Luhna) |
| telefon komórkowy, numer po słowie „tel.”, e-mail | wzorce (bez kwot i adresów gov.pl) |
| adres zamieszkania | ulica z numerem mieszkania albo adres przy słowach „mieszka przy”, „zam.”… |
| dane osób prywatnych (np. nazwisko + choroba) | model w filtrze wstępnym (kategoria `dane_osobowe`) |

- Dane w tekście użytkownika i na zdjęciach **blokują** zgłoszenie z komunikatem, czego dotyczą.
- Dane na stronach z linków są **wycinane** (np. telefon redakcji w stopce artykułu).
- Wartości (np. sam PESEL) nie wracają w odpowiedzi serwera.
- Zablokowane zgłoszenia nie trafiają do historii w przeglądarce ani do rejestru nierozstrzygniętych spraw.
- Imiona, nazwiska, funkcje i daty urodzenia osób publicznych nie są blokowane.

## Prompt injection

Treść zgłoszeń, stron i zdjęć może zawierać polecenia dla modelu („zignoruj instrukcje…”). Dlatego:

- zasady modeli są w osobnym prompcie systemowym, a dane w oznaczonych znacznikach (w filtrze tematu
  z losowym kodem przy każdym zapytaniu),
- prompty mówią wprost, że treść to niezaufane dane,
- treść pobranych stron jest skanowana pod kątem prób manipulacji (`security_flags`),
- kod sprawdza odpowiedzi modeli: filtr tematu może tylko przepisywać zdania z treści, a cytaty tez
  i dowodów muszą być dosłowne (patrz [Werdykty i źródła](werdykty_i_zrodla.md)).

## Pobieranie stron (SSRF)

Serwer pobiera adresy podane przez użytkownika (linki) i adresy ze źródeł. Przed każdym pobraniem
i po każdym przekierowaniu sprawdza adres: blokuje localhost, sieci prywatne, sieć Tailscale
(100.64.0.0/10) i niedozwolone protokoły. Wyszukiwarka dowodów pobiera wyłącznie z hostów z katalogu
zaufanych źródeł. Limity rozmiaru i czasu chronią przed bardzo dużymi stronami.

Zabezpieczenia stron (Cloudflare, WAF, CAPTCHA) **nie są omijane** – takie źródło jest raportowane
jako niedostępne.

## Wejście i odpowiedzi

- Walidacja body (`backend/wspolne/zabezpieczenia.js`): typy pól, długość tekstu, liczba i rozmiar zdjęć,
  format linków; parametryzowane wejście bez składania zapytań z tekstu użytkownika.
- Strona i rozszerzenie wstawiają treść z serwera wyłącznie jako tekst (bez HTML), a linki tylko `http(s)`.
- Rozszerzenie nie czyta stron i nie wstrzykuje skryptów – dostaje tylko to, co użytkownik zaznaczył.
  Domyślnie ma dostęp tylko do `localhost:3000`, inne adresy wymagają zgody użytkownika.

## Sekrety

Klucz `GOOGLE_FACTCHECK_API_KEY` jest tylko w pliku `.env` (w `.gitignore`), nigdy w repozytorium.

## Dziennik sprawdzeń, retencja i limit zapytań

- Każde sprawdzenie jest zapisywane w `backend/dane/dziennik_sprawdzen.jsonl` (poza repozytorium):
  id, czas, kanał, pytanie, wynik, tezy z werdyktami, użyte źródła (tytuł, wydawca, data, link),
  czas odpowiedzi i zdarzenia bezpieczeństwa (np. wykryte próby prompt injection).
- Zgłoszenia zablokowane przez filtr danych osobowych są zapisywane **bez treści**.
- Retencja: wpisy starsze niż `KOMA_RETENCJA_DNI` (domyślnie 30 dni) są usuwane automatycznie.
- Usunięcie sesji: `DELETE /api/sprawdzenia/:id`.
- Limit: 10 sprawdzeń na minutę z jednego IP (`KOMA_LIMIT_NA_MINUTE`), potem odpowiedź 429.
