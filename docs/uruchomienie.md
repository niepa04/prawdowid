# Uruchomienie

## Wymagania

- Node.js 22 lub nowszy (testowane na 24)
- Serwer [Ollama](https://ollama.com) z modelami z `config/modele.js`:
  ```
  ollama pull qwen3.5:9b
  ollama pull glm-ocr:latest
  ```
- (opcjonalnie) klucz Google Fact Check Tools API – oceny fact-checkerów

> Obecnie modele działają na osobnym komputerze w sieci Tailscale zespołu (`OLLAMA_URL`).
> Docelowo Ollama będzie działać na tym samym serwerze co Koma.

## Instalacja

```
npm install
npm install --prefix front-end
cp .env.example .env        # uzupełnij GOOGLE_FACTCHECK_API_KEY i ewentualnie OLLAMA_URL
```

## Start

```
npm run build               # buduje stronę (front-end/dist)
npm start                   # serwer: http://localhost:3000 (strona + API)
```

Serwer wypisuje też adres w sieci Tailscale, jeśli jest dostępny.

### Tryb deweloperski

```
npm run dev                 # serwer z automatycznym restartem po zmianach (port 3000)
npm run dev:front           # strona z przeładowaniem na żywo: http://localhost:5173 (API przez proxy na 3000)
```

## Rozszerzenie przeglądarki

1. `chrome://extensions` (Edge: `edge://extensions`) → włącz **Tryb dewelopera**.
2. **Załaduj rozpakowane** → wskaż folder `extension`.
3. Zaznacz tekst albo kliknij obrazek prawym przyciskiem → **Weryfikuj w Koma**.

Inny adres serwera (np. Tailscale): kliknij ikonę rozszerzenia. Szczegóły: [extension/README.md](../extension/README.md).

## Testy

```
npm test                    # testy jednostkowe
npm run test:werdykty       # testy jakości werdyktów (wymaga modeli, długo)
```

Szczegóły: [Testy](testy.md).
