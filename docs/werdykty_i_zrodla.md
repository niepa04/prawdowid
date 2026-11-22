# Werdykty i źródła

## Werdykty

| Werdykt | Znaczenie |
|---|---|
| **Potwierdzone** | Źródła potwierdzają tezę (dosłowny fragment źródła na temat tezy). |
| **Fałszywe** | Źródła lub fact-checkerzy zaprzeczają tezie. |
| **Wprowadzające w błąd** | Teza ma prawdziwe elementy, ale przekręca fakty albo pomija ważny kontekst. |
| **Brak wystarczających dowodów** | Nie znaleziono materiałów, które rozstrzygają tezę. To **nie** znaczy, że jest fałszywa. |
| **Nie podlega weryfikacji** | Opinia, ocena albo pytanie bez faktu do sprawdzenia. |
| **Nie można teraz sprawdzić** | Wyszukiwarka źródeł (lub baza fact-checkerów) nie działała – nie wiemy, czy dowody istnieją. |
| **Zablokowano: dane osobowe** | Zgłoszenie zawierało dane osobowe i nie zostało sprawdzone. |

Zgłoszenie z kilkoma tezami dostaje werdykt dla każdej tezy osobno oraz werdykt ogólny.

## Zasady, których pilnuje kod (nie tylko model)

Model językowy (9B) bywa niepewny, dlatego Weryfikator Prawdy (`backend/weryfikator/weryfikatorPrawdy.js`)
sprawdza jego odpowiedź:

1. **Teza = słowa użytkownika.** Cytat tezy musi być dosłownie w zgłoszeniu (pytanie zostaje pytaniem).
   Model nie może przeformułować ani dopisać nazwisk.
2. **Dowód = dosłowny fragment.** Stanowisko dowodu („potwierdza”/„zaprzecza”) liczy się tylko wtedy,
   gdy cytowany fragment naprawdę jest w materiale. Zmyślony cytat nie rozstrzyga.
3. **Spójność.** „Potwierdzone” wymaga dowodu potwierdzającego, „Fałszywe” – zaprzeczającego. Brak
   potwierdzenia to nie zaprzeczenie – wtedy „Brak wystarczających dowodów”.
4. **Ocena fact-checkera rozstrzyga**, jeśli dotyczy tej samej tezy. Gdy fact-checker ocenił twierdzenie
   **przeciwne** („szczepionki NIE powodują…” vs „szczepionki powodują…”), ocena jest odwracana.
5. **Opinia** dostaje „Nie podlega weryfikacji” niezależnie od materiałów.
6. **„Brak” bez źródeł.** Werdykt „Brak wystarczających dowodów” nie pokazuje przypadkowych źródeł.

## Skąd Koma bierze dowody

Wyszukiwarka dowodów (`backend/wyszukiwarka_dowodow/`) korzysta tylko z zaufanych miejsc:

1. **Źródła urzędowe** – katalog 40 źródeł (`config/zrodla/zrodla_oficjalne.json`): gov.pl (w tym system
   ostrzeżeń RSO), KPRM, RCB, MON, MSWiA, Policja, PSP, GIS, GIOŚ, PAA, CERT Polska, IMGW, urzędy morskie,
   GDDKiA i inne. Wyszukiwarka dobiera źródła do tematu, schodzi po linkach (do 2 poziomów) i korzysta
   z RSS/API, gdy są dostępne. Gdy do tematu nie pasuje żadne źródło, przeszukuje kanały ogólne
   (KPRM, RCB, MON, RSO).
2. **Google Fact Check Tools API** – gotowe oceny polskich fact-checkerów (Demagog, Sprawdzam AFP,
   Konkret24, FakeNews.pl).
3. **Artykuły Demagoga** – adresy pasujących artykułów pochodzą z bazy Google; wyszukiwarka je otwiera
   i czyta. Zabezpieczenia stron (np. Cloudflare) **nie są omijane**.

### Wyszukiwanie ocen fact-checkerów

Wyszukiwarka Google wymaga wszystkich słów zapytania w dokładnej formie, a oceniane twierdzenie bywa
sformułowane inaczej niż zgłoszenie (np. długi cytat polityka). Dlatego:

- plan researchu podaje słowa kluczowe z odmianami i synonimami („Wrocław/Wrocławiu”, „darmowa/bezpłatnie”),
- powstaje do 40 zapytań na twierdzenie: pary i trójki najważniejszych słów, sąsiednie słowa ze zdania,
  pojedyncze słowa,
- ocena pasuje, gdy zgadza się z cytatem, z **tytułem artykułu** fact-checkera albo pokrywa większość
  słów zgłoszenia (co najmniej 2 wspólne słowa poza nazwami własnymi; liczby muszą się zgadzać –
  „zakaz od 2025” to nie „zakaz od 2035”).

### Awaria źródeł

Jeśli wyszukiwarka nie mogła niczego przeszukać, Koma odpowiada „Nie można teraz sprawdzić”, a nie
„Brak wystarczających dowodów” – brak wyników przy niedziałającej wyszukiwarce nie jest brakiem dowodów.
