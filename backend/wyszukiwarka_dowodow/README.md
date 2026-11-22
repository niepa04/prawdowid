# Wyszukiwarka dowodów (dawniej „Model 3”) – wyszukiwanie i zbieranie dowodów

> Folder: `backend/wyszukiwarka_dowodow/`. Wywołuje ją Research Gatherer (`backend/research/researchGatherer.js`).
> Katalog źródeł, mapa tematów i lista fact-checkerów są w głównym folderze `config/zrodla/`.

Model 3 jest wyspecjalizowanym modułem zbierania dowodów dla projektu **KOMA / PRAWDOWID**. Jego jedyną podstawą jest katalog 40 zatwierdzonych źródeł urzędowych i instytucjonalnych:

- Katalog źródeł: `config/zrodla/zrodla_oficjalne.json` (40 źródeł urzędowych + Demagog jako SRC041)
- Empiryczna mapa źródeł: `config/zrodla/mapa_tematow.json`
- Zaufani fact-checkerzy i Google Fact Check Tools API: `config/zrodla/fact_checkerzy.json`

Model 3 **nie jest ogólną wyszukiwarką internetową** i **nie wydaje werdyktów prawda/fałsz**. Jego zadaniem jest dobranie właściwych źródeł z katalogu, pobranie dostępnych komunikatów i bieżących danych pomiarowych, wyodrębnienie dosłownych fragmentów, sprawdzenie aktualności i potencjalnych sprzeczności oraz przekazanie zwalidowanego pakietu dowodowego do Research Gatherera, a dalej do Weryfikatora Prawdy.

---

## 1. Jak działa Model 3 (przepływ danych)

1. **Rejestr i walidacja katalogu (`sourceRegistry.js`)**:
   - Wczytuje `zrodla_oficjalne.json` i scala go z `mapa_tematow.json`.
   - Buduje ścisłą listę dozwolonych hostów (`allowedHosts`) wyłącznie z aktywnych (`enabled: true`) wpisów.
   - Blokuje wszystkie inne domeny, niezatwierdzone subdomeny (np. `api.gios.gov.pl`, `danepubliczne.imgw.pl`), `localhost`, prywatne sieci IP i niedozwolone protokoły (SSRF) **przed** wykonaniem żądania.
2. **Routing tematyczny (`sourceRouter.js`)**:
   - Analizuje każde twierdzenie wraz z jego powiązaniami `related_to` z Modelu 2, typem twierdzenia (`event`, `location`, `temporal_qualifier`, `opinion`, `non_verifiable` itd.) oraz encjami/instytucjami/regionami.
   - Dobiera maksymalnie `maxSourcesPerClaim` (domyślnie 6) najlepiej dopasowanych źródeł zamiast odpytywać wszystkie 40 adresów.
   - Rozróżnia role źródeł (`warnings`, `live_measurements`, `news_alerts`, `informational`, `guide`, `contact_info`) – domyślnie pomija strony kontaktowe (`SRC018`, `SRC019`) przy weryfikacji incydentów.
   - Nie marnuje wszystkich slotów na wiele zablokowanych adresów z tego samego hosta (np. 3 podstrony GDDKiA pod Incapsulą) – wybiera 1 reprezentatywne źródło do zaraportowania blokady, zostawiając miejsce dla działających źródeł (np. `SRC002` gov.pl RSO).
3. **Generowanie zapytań (`queryGenerator.js`)**:
   - Tworzy 3–5 zróżnicowanych zapytań na twierdzenie, dopasowanych do wybranych domen (`site:<host>`), oraz dedykowane zapytania w Rundzie 2 ukierunkowane na sprawdzanie odwołań, dementi i aktualizacji.
4. **Bezpieczne pobieranie (`sourceFetcher.js`)**:
   - Sprawdza host i SSRF (w tym weryfikację DNS przeciwko DNS rebinding) przed każdym żądaniem oraz przy **każdym przekierowaniu HTTP** (`redirect: 'manual'`).
   - Przekierowanie poza zatwierdzony host jest natychmiast blokowane (`redirect_blocked`) i zapisywane w `security_flags`.
   - Egzekwuje limity rozmiaru dokumentu (`MODEL3_MAX_DOCUMENT_SIZE`) i czasu odpowiedzi (`MODEL3_TIMEOUT_MS`).
   - Wykrywa zapory WAF/antybot (Incapsula, Cloudflare, Captcha) i raportuje `blocked_by_waf` **bez omijania zabezpieczeń**.
   - Skanuje pobrane treści pod kątem prób **prompt injection** i zapisuje je w `security_flags`; treści stron są zawsze traktowane jako niezaufane dane.
5. **Wspólne adaptery parsowania (`contentExtractor.js`)**:
   - **Adapter HTML**: tytuł (`og:title` / `<h1>` / `<title>`), wydawca, daty (Open Graph, JSON-LD, `<time>`, klasy dat `gov.pl`), czysty tekst artykułu, linki do podstron w obrębie dozwolonych hostów, detekcja pustych powłok SPA.
   - **Adapter RSS/Atom**: parsuje potwierdzone kanały XML (CERT Polska `https://moje.cert.pl/advisories/feed/`, UTK `https://utk.gov.pl/dokumenty/rss/1-rss-1894.rss`).
   - **Adapter JSON/API**: obsługuje potwierdzone endpointy na zatwierdzonych hostach:
     - `gov.pl` RSO JSON (`https://www.gov.pl/api/data/proxy/rso/komunikatyxml/...`),
     - WordPress REST API (`https://kgsok.pl/wp-json/wp/v2/posts`).
   - **Adapter danych pomiarowych**:
     - PAA OGC WFS GeoJSON (`https://monitoring.paa.gov.pl/geoserver/ows?...typeName=paa:kcad_siec_pms_moc_dawki_mapa&outputFormat=application/json`) – zapisuje stację, wartość, jednostkę (`µSv/h`), czas pomiaru (`observed_at`) i czas pobrania (`retrieved_at`),
     - GIOŚ HTML (`/pjp/warnings`, `/pjp/current`) – z kontrolą potwierdzenia aktualności pomiaru.
6. **Dopasowanie do twierdzenia (`evidenceMatcher.js`)**:
   - Dopasowuje dokumenty osobno do każdego `claim_id` z Modelu 2.
   - Wyodrębnia **wyłącznie dosłowne fragmenty** (`relevant_excerpts`) z pobranej treści (zero fikcyjnych cytatów).
   - Klasyfikuje relację jako `supporting`, `contradicting` (wykrywając m.in. odwołania, dementi, brak przekroczeń, niezgodność polarności) lub `contextual`.
   - Oznacza nieaktualne komunikaty (`valid_to < now`, przestarzałe pomiary, brak daty publikacji) w `limitations`.
7. **Deduplikacja i grupy niezależności (`deduplicator.js`)**:
   - Kanonizuje URL (usuwa `utm_*`, `fbclid`, `gclid`, fragmenty `#...`), usuwa duplikaty i przypisuje wspólne `independence_group` powielonym komunikatom z różnych źródeł.
8. **Automatyczne rundy i równoległość (`evidenceCollector.js`, `wyszukiwarkaDowodow.js`)**:
   - Wykonuje do `maxRounds` (domyślnie 3) rund bez udziału użytkownika, przetwarzając niezależne twierdzenia równolegle z limitem `maxConcurrency`.
9. **Końcowa walidacja (`validators/evidenceValidator.js`)**:
   - Gwarantuje poprawny schemat JSON, zachowanie wszystkich `claim_id`, brak pól werdyktowych oraz to, że **każdy** dowód w `evidence[]` pochodzi z zatwierdzonego hosta.

---

## 2. Wyniki audytu 40 źródeł z katalogu

Audyt przeprowadzony bezpośrednio wobec wszystkich 40 adresów z `zrodla_oficjalne.json`:

### Źródła działające bezpośrednio (27 / 40)
- **JSON / WFS API na zatwierdzonych hostach (4)**:
  - `SRC002` `gov.pl` Ostrzeżenia RSO (ogólnopolskie) – `/api/data/proxy/rso/komunikatyxml/wszystkie/wszystkie/0?_format=json`
  - `SRC003` `gov.pl` Ostrzeżenia RSO (mazowieckie) – `/api/data/proxy/rso/komunikatyxml/mazowieckie/wszystkie/0?_format=json`
  - `SRC012` Monitoring radiacyjny PAA – OGC WFS GeoJSON (`paa:kcad_siec_pms_moc_dawki_mapa`)
  - `SRC029` KGSOK (Straż Ochrony Kolei) – WordPress REST API (`/wp-json/wp/v2/posts`)
- **Potwierdzone kanały RSS 2.0 (2)**:
  - `SRC014` CERT Polska – `https://moje.cert.pl/advisories/feed/`
  - `SRC028` UTK – `https://utk.gov.pl/dokumenty/rss/1-rss-1894.rss`
- **Dostępne strony HTML (21)**:
  - `SRC004` MSWiA RSO (informacyjna), `SRC005` RCB Raport dobowy, `SRC006` KG PSP, `SRC007` Policja, `SRC008` Policja Mazowiecka, `SRC009` MON, `SRC010` GIS Ostrzeżenia, `SRC011` PAA, `SRC013` GIOŚ (`/pjp/`, `/pjp/warnings`, `/pjp/current`), `SRC015`–`SRC019` Ministerstwo Infrastruktury (`SRC018` i `SRC019` to strony kontaktowe), `SRC023` GDDKiA 19 111 (informacyjna), `SRC031` Urząd Morski w Gdyni, `SRC032` Urząd Morski w Szczecinie, `SRC033` Wody Polskie, `SRC037` RCB, `SRC038` MSWiA, `SRC040` KPRM.

### Źródła wymagające dodatkowej pracy / z ograniczeniami technicznymi (13 / 40)
- **Blokada WAF Incapsula (`/_Incapsula_Resource`) – 7 źródeł** (Model 3 nie obchodzi zabezpieczeń):
  - `SRC020`, `SRC021`, `SRC022` (`drogi.gddkia.gov.pl`) – część bieżących utrudnień na autostradach i drogach krajowych jest jednak dostępna przez `SRC002` (`gov.pl` RSO),
  - `SRC024`, `SRC025`, `SRC026` (`ulc.gov.pl`),
  - `SRC030` (`www.sar.gov.pl`).
- **Niekompletny łańcuch certyfikatu TLS po stronie serwera – 1 źródło** (weryfikacja TLS nie jest wyłączana):
  - `SRC027` (`portalpasazera.pl`) – `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
- **Aplikacje Angular SPA bez statycznego HTML i bez potwierdzonego otwartego API na tym samym hoście – 5 źródeł**:
  - `SRC001` (`odyseusz.gov.pl`) i `SRC039` (`gov.pl/web/dyplomacja/informacje-dla-podrozujacych` → HTTP 302 na `odyseusz.gov.pl`),
  - `SRC034` (`meteo.imgw.pl`), `SRC035` (`hydro.imgw.pl`, `/api/station/hydro/` → HTTP 403), `SRC036` (`baltyk.imgw.pl`).
  *(Uwaga: `danepubliczne.imgw.pl` i `api.gios.gov.pl` nie znajdują się w katalogu 40 źródeł, dlatego zgodnie z zasadą z sekcji 2 nie są używane.)*

---

## 3. Użycie i konfiguracja

### Użycie
```js
const wyszukiwarkaDowodow = require('./backend/wyszukiwarka_dowodow/wyszukiwarkaDowodow');

// Research Gatherer przekazuje pytania badawcze i zdania użytkownika jako "claims"
const evidence = await wyszukiwarkaDowodow({
  original_text: 'Wprowadzono ostrzeżenie przed silnym wiatrem w województwie mazowieckim.',
  claims: [{ id: 'u1', claim: 'Wprowadzono ostrzeżenie przed silnym wiatrem w województwie mazowieckim.', type: 'event' }],
});
console.log(JSON.stringify(evidence, null, 2));
```

### Zmienne środowiskowe
- `MODEL3_OLLAMA_MODEL` – nazwa modelu Ollama (opcjonalnie, domyślnie model `analiza` z `config/modele.js`)
- `MODEL3_TIMEOUT_MS` – limit czasu żądania HTTP w ms (domyślnie `15000`)
- `MODEL3_MAX_QUERIES` – maks. liczba zapytań na rundę (domyślnie `5`)
- `MODEL3_MAX_ROUNDS` – maks. liczba rund wyszukiwania (domyślnie `3`)
- `MODEL3_MAX_CONCURRENCY` – maks. liczba równolegle przetwarzanych twierdzeń (domyślnie `4`)
- `MODEL3_MAX_DOCUMENT_SIZE` – maks. rozmiar pobieranego dokumentu w bajtach (domyślnie `2097152`, czyli 2 MB)
- `MODEL3_SOURCE_REGISTRY_PATH` – ścieżka do katalogu JSON (domyślnie `config/zrodla/zrodla_oficjalne.json`)
- `MODEL3_STRICT_TRUSTED_SOURCES` – ścisłe wymuszanie katalogu źródeł (domyślnie `true`)

### Opcjonalna zewnętrzna wyszukiwarka
Model 3 działa samodzielnie na podstawie katalogu JSON oraz wewnętrznych wyszukiwarek na zatwierdzonych hostach (`www.gov.pl/web/gov/szukaj`, `kgsok.pl/wp-json/wp/v2/posts?search=`). W razie potrzeby administrator może przekazać `options.externalSearchImpl` (np. płatne API wyszukiwarki jak Google Custom Search / Brave Search / Serper), ale:
- wymaga to klucza API w zmiennych środowiskowych (nigdy w kodzie) i wiąże się z limitami/kosztami wybranej usługi,
- **każdy** URL zwrócony przez wyszukiwarkę przechodzi najpierw przez `sourceRegistry.validateUrl()` i nigdy nie stanowi samodzielnego dowodu.

---

## 4. Jak dodać kolejne źródło po zatwierdzeniu przez administratora

1. Zatwierdzony URL dopisać do tablicy `sources` w `config/zrodla/zrodla_oficjalne.json` z `"enabled": true`.
2. Uruchomić audyt źródła przez `discoverAllSources()` z `backend/wyszukiwarka_dowodow/sourceDiscovery.js`, aby zweryfikować dostępność, status HTTP, obecność RSS/Atom/API, SPA i ewentualne ograniczenia WAF/TLS.
3. Dopisać zweryfikowany wpis metadanych (z kolejnym `source_id`, kategorią, tematami, rolą i potwierdzonymi metodami dostępu) do `config/zrodla/mapa_tematow.json`.
4. Uruchomić testy `npm test` i zweryfikować routing oraz walidację.
