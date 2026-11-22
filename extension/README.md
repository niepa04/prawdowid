# Koma – rozszerzenie do przeglądarki

- **Tekst:** zaznacz tekst na dowolnej stronie, kliknij prawym przyciskiem i wybierz **„Weryfikuj w Koma”**.
- **Zdjęcie:** kliknij obrazek prawym przyciskiem i wybierz **„Weryfikuj zdjęcie w Koma”** – tekst ze zdjęcia odczyta OCR na serwerze.

W osobnym okienku pojawi się werdykt, uzasadnienie i źródła z serwera Koma (`/api/weryfikuj`).

Zdjęcia są pobierane w okienku i zamieniane na JPEG (do 2000 px), bo OCR czyta tylko PNG/JPEG.
Jeśli serwer, na którym jest zdjęcie, nie pozwala go pobrać (CORS), okienko poprosi o zgodę na
pobieranie zdjęć z tej jednej domeny. Zdjęć osadzonych jako `blob:` nie da się pobrać – trzeba je
zapisać na dysku i wkleić na stronie Koma.

Po aktualizacji rozszerzenia (nowa pozycja menu) kliknij odświeżanie przy rozszerzeniu w `chrome://extensions`.

Działa w Chrome, Edge, Brave, Operze i innych przeglądarkach opartych na Chromium (Manifest V3).

## Instalacja (tryb dewelopera)

1. Zbuduj stronę i uruchom serwer Koma: `npm run build`, potem `npm start` (domyślnie `http://localhost:3000`).
   Przycisk „Otwórz Koma w przeglądarce” w okienku wyniku prowadzi na stronę Koma serwowaną przez ten serwer (Express).
2. Otwórz `chrome://extensions` (w Edge: `edge://extensions`).
3. Włącz **Tryb dewelopera** (przełącznik w prawym górnym rogu).
4. Kliknij **Załaduj rozpakowane** i wskaż folder `extension`.
5. Zaznacz tekst na dowolnej stronie → prawy przycisk → **Weryfikuj w Koma**.

Po zmianach w plikach rozszerzenia kliknij ikonę odświeżania przy rozszerzeniu na stronie `chrome://extensions`.

## Inny adres serwera (np. Tailscale)

Kliknij ikonę rozszerzenia (albo „Szczegóły” → „Opcje rozszerzenia”), wpisz adres, np. `http://100.x.y.z:3000`,
i kliknij **Zapisz**. Przeglądarka zapyta o zgodę na połączenie z tym jednym adresem.
Przycisk **Sprawdź połączenie** sprawdza, czy serwer odpowiada (`/api/status`).

## Bezpieczeństwo i prywatność

- Rozszerzenie nie czyta stron i nie wstrzykuje do nich skryptów – dostaje tylko tekst albo adres zdjęcia, które użytkownik sam wskazał w menu.
- Zdjęcia pobiera bez ciasteczek (`credentials: omit`), a dostęp do obcych domen tylko po zgodzie użytkownika.
- Tekst idzie wyłącznie na skonfigurowany serwer Koma. Domyślnie rozszerzenie ma dostęp tylko do `localhost:3000`; inne adresy wymagają zgody użytkownika.
- Odpowiedź serwera jest wstawiana do okna wyłącznie jako tekst (bez HTML), a linki do źródeł tylko z `http(s)`.

## Pliki

| Plik | Rola |
|---|---|
| `manifest.json` | opis rozszerzenia i uprawnienia |
| `background.js` | pozycja w menu pod prawym przyciskiem, otwiera okno wyniku |
| `wynik.html`, `wynik.js` | okno wyniku: zapytanie do serwera i werdykt |
| `ustawienia.html`, `ustawienia.js` | adres serwera Koma |
| `wspolne.js`, `styl.css` | wspólne funkcje i wygląd |
| `ikony/` | ikony 16–128 px |

## Dane osobowe

Serwer Koma blokuje zgłoszenia z danymi osobowymi (PESEL, numery dokumentów, konta, karty, telefony,
e-maile, adresy zamieszkania, prywatne informacje o osobach prywatnych). Okienko pokazuje wtedy
komunikat „Ochrona prywatności – Zablokowano: dane osobowe” z listą wykrytych rodzajów danych.
