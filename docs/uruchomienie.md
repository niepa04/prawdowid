# Uruchomienie

## Wersja demonstracyjna online (bez instalacji lokalnych modeli AI)

Ponieważ Koma korzysta z lokalnych modeli AI na serwerze Ollama (`qwen3.5:9b`, `glm-ocr:latest`), udostępniamy działającą instancję projektu gotową do testów bez konieczności pobierania modeli na komputer Jury:

- **Strona główna (Weryfikator WWW):** [https://bird-seq-jonathan-vice.trycloudflare.com/](https://bird-seq-jonathan-vice.trycloudflare.com/)
- **Panel analityczny i radar alertów (`/alarmy`):** [https://bird-seq-jonathan-vice.trycloudflare.com/alarmy](https://bird-seq-jonathan-vice.trycloudflare.com/alarmy)
- **Zaufane źródła (`#zrodla`):** [https://bird-seq-jonathan-vice.trycloudflare.com/#zrodla](https://bird-seq-jonathan-vice.trycloudflare.com/#zrodla)

---

## Uruchomienie lokalne od zera

### Wymagania

- Node.js 22 lub nowszy (testowane na 22 i 24)
- Serwer [Ollama](https://ollama.com) z modelami z `config/modele.js`:
  ```bash
  ollama pull qwen3.5:9b
  ollama pull glm-ocr:latest
  ```
- (opcjonalnie) klucz Google Fact Check Tools API – oceny polskich fact-checkerów

### 1. Pobranie i instalacja głównego serwera (`backend/` + `front-end/`)

```bash
git clone https://github.com/niepa04/prawdowid.git
cd prawdowid

npm install
npm install --prefix front-end
cp .env.example .env        # uzupełnij GOOGLE_FACTCHECK_API_KEY i ewentualnie OLLAMA_URL
```

### 2. Start serwera WWW i API

```bash
npm run build               # buduje stronę (front-end/dist)
npm start                   # serwer: http://localhost:3000 (strona + API + panel /alarmy)
```

Tryb deweloperski:
```bash
npm run dev                 # serwer z automatycznym restartem po zmianach (port 3000)
npm run dev:front           # strona z przeładowaniem na żywo: http://localhost:5173 (API przez proxy na 3000)
```

---

## Uruchomienie botów i dodatkowych kanałów

### 3. Bot Discord (`discord-bot/`)

Obsługuje komendy `/sprawdz` (tekst, linki, załącznik ze zdjęciem/zrzutem ekranu do OCR), `/status` oraz `/pomoc`.

```bash
cd discord-bot
npm install
cp .env.example .env        # uzupełnij DISCORD_TOKEN, CLIENT_ID, GUILD_ID oraz KOMA_API_URL
npm run deploy              # rejestracja komend slash na serwerze Discord
npm start                   # uruchomienie bota
```

### 4. Bot Facebook Messenger (`messenger-bot/`)

Odbiera wiadomości prywatne na Messengerze (tekst, linki, zdjęcia do OCR) przez webhook Meta Graph API (`POST /webhook`) i odsyła sformatowany werdykt ze źródłami.

```bash
cd messenger-bot
npm install
cp .env.example .env        # uzupełnij PORT, KOMA_API_URL, VERIFY_TOKEN, PAGE_ACCESS_TOKEN, META_APP_SECRET, PAGE_ID
npm start                   # webhook nasłuchuje na http://localhost:3001/webhook
```
Szczegóły wystawienia webhooka przez Cloudflare Tunnel i konfiguracji w Meta Developer Portal: [messenger-bot/MESSENGER_SETUP.md](../messenger-bot/MESSENGER_SETUP.md).

### 5. Rozszerzenie przeglądarki (`extension/`)

1. Otwórz `chrome://extensions` (Edge: `edge://extensions`) → włącz **Tryb dewelopera**.
2. Kliknij **Załaduj rozpakowane** → wskaż folder `extension/`.
3. Zaznacz tekst albo kliknij obrazek prawym przyciskiem → **Weryfikuj w Koma**.

Inny adres serwera (np. `https://bird-seq-jonathan-vice.trycloudflare.com`): kliknij ikonę rozszerzenia na pasku. Szczegóły: [extension/README.md](../extension/README.md).

### 6. Detektor obrazów AI (`ai-image-detector/` – opcjonalnie)

Mikroserwis `POST /api/detect-ai` oceniający prawdopodobieństwo wygenerowania obrazu przez AI (`Smaug-AI-Image-Detector-GGUF` na `llama-server`).

```bash
cd ai-image-detector
npm install
cp .env.example .env
npm start                   # http://localhost:4000
```
Szczegóły: [ai-image-detector/README.md](../ai-image-detector/README.md).

---

## Testy

```bash
npm test                    # testy jednostkowe backendu
npm run test:werdykty       # testy jakości werdyktów (wymaga modeli)
```
Szczegóły: [Testy](testy.md).
