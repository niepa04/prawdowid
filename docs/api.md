# API

Serwer: `backend/serwer.js`, domyślnie `http://localhost:3000`.

## `GET /api/status`

Stan serwera, kroki sprawdzania i liczba źródeł w katalogu.

## `POST /api/weryfikuj`

Sprawdza zgłoszenie. Body (JSON):

```json
{
  "tekst": "Dowolny tekst. Może zawierać linki https://... i wklejone zdjęcia data:image/png;base64,...",
  "linki": ["https://..."],
  "zdjecia": ["data:image/jpeg;base64,..."]
}
```

Wszystkie pola są opcjonalne, ale musi być co najmniej jedno. Limity: tekst do 50 000 znaków, do 20 linków,
do 10 zdjęć po 5 MB (PNG, JPEG, GIF, WebP, BMP; OCR czyta najlepiej PNG/JPEG). Linki muszą prowadzić do
stron publicznych (adresy wewnętrzne są blokowane).

### Odpowiedź (200)

```json
{
  "status": "completed",
  "werdykt_ogolny": "Fałszywe",
  "tekst": "===== [TEKST] =====\n...",
  "model1": { "tekst": "...", "czas_ms": 150 },
  "research": {
    "plan": { "temat": "...", "pytania_badawcze": [{ "pytanie": "...", "zapytanie": "..." }], "slowa_kluczowe": ["..."] },
    "notatka": { "streszczenie": "...", "ustalenia": [{ "tresc": "...", "zrodla": [1] }], "luki": ["..."] },
    "materialy": [{ "nr": 1, "wydawca": "Demagog", "tytul": "...", "url": "https://...", "ocena_fact_checkera": "Fałsz" }],
    "dostepnosc": { "awaria": false, "baza_fact_checkerow": true, "zrodla_oficjalne": true }
  },
  "demagog": {
    "werdykt_ogolny": "Fałszywe",
    "glowna_odpowiedz": "...",
    "twierdzenia": [
      {
        "claim_id": "t1",
        "claim": "Teza słowo w słowo z tekstu użytkownika",
        "werdykt": "Fałszywe",
        "sila_dowodow": "wysoka",
        "uzasadnienie": "...",
        "uzyte_zrodla": [{ "title": "...", "publisher": "...", "url": "https://...", "published_at": "2024-03-12" }]
      }
    ]
  },
  "metadane": {
    "czas_calkowity_ms": 39000,
    "etapy_ukonczone": ["model1", "filtr_danych_osobowych", "filtr_wstepny", "research", "weryfikator"],
    "liczba_twierdzen": 1,
    "liczba_dowodow": 14,
    "ostrzezenia": ["..."],
    "security_flags": []
  }
}
```

### `status`

| Wartość | Kiedy |
|---|---|
| `completed` / `partial` / `no_results` | normalne sprawdzenie (`partial` – część źródeł niedostępna) |
| `rejected` | zatrzymane przez filtr: dane osobowe (`metadane.dane_osobowe = true`) albo brak tezy, spam, polecenie |
| `unavailable` | wyszukiwarka nie działała – werdykt „Nie można teraz sprawdzić” |

### Błędy

| Kod | Kiedy |
|---|---|
| 400 | błędne zapytanie (puste, za długie, zły link, zły format zdjęcia) |
| 413 | za duże body |
| 501 | nieobsługiwany typ (np. film) |
| 502 | błąd jednego z kroków |
| 503 | model AI niedostępny – nie da się teraz sprawdzić |
| 504 | sprawdzanie trwało dłużej niż limit (domyślnie 8 minut) |

Błąd ma postać `{ "blad": "komunikat po polsku" }`.

## Monitoring i system alertów w tle

- `GET /api/alerty?status=aktywne_i_monitorowane&limit=50` – statystyki dzienne/godzinne, aktywne alerty podejrzanej nadaktywności z podsumowaniem sytuacyjnym i bilansem werdyktów oraz lista klastrów tematycznych.
- `GET /api/alerty/:id` – szczegóły wskazanego klastra tematycznego oraz pogrupowane warianty pytań użytkowników.
- `POST /api/alerty/:id/status` (lub `PATCH`) – zmiana statusu alertu (`{ "status": "aktywny" | "monitorowany" | "zamkniety" }`).
- `POST /api/alerty/analizuj` – ręczne uruchomienie przeliczenia kolejki tła i detektora nadaktywności.
