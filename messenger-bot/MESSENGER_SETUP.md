# Konfiguracja bota Facebook Messenger dla KOMA (PRAWDOWID)

Bot działa jako osobny serwis w folderze `messenger-bot/` (obok `prawdowid/` i `discord-bot/`) i komunikuje się z backendem KOMA po HTTP (`KOMA_API_URL=http://localhost:3000`).

## 1. Zmienne środowiskowe (`messenger-bot/.env`)

```env
PORT=3001
KOMA_API_URL=http://localhost:3000
VERIFY_TOKEN=KOMA_VERIFY_2026_X7p9Q2mL
PAGE_ACCESS_TOKEN=<wklej_wygenerowany_token_strony>
META_APP_SECRET=<wklej_app_secret_z_meta>
PAGE_ID=<wklej_id_strony_facebook>
```

## 2. Uruchomienie

1. Uruchom backend KOMA (`prawdowid/` na porcie `3000`):
   ```powershell
   cd c:\Users\konra\Desktop\hacknation\prawdowid
   npm start
   ```
2. Uruchom bota Messenger (`messenger-bot/` na porcie `3001`):
   ```powershell
   cd c:\Users\konra\Desktop\hacknation\messenger-bot
   npm start
   ```

## 3. Cloudflare Tunnel

```powershell
cloudflared tunnel --url http://localhost:3001
```

**Callback URL** do wpisania w Meta Developer Portal:
`https://<twoj-adres>.trycloudflare.com/webhook`

**Verify Token:** `KOMA_VERIFY_2026_X7p9Q2mL`

## 4. Meta Developer Portal

1. **App Settings → Basic**: skopiuj **App Secret** → `META_APP_SECRET`.
2. **Messenger → API Setup**: podłącz stronę, skopiuj **Page ID** → `PAGE_ID` i wygeneruj token → `PAGE_ACCESS_TOKEN`.
3. **Webhooks → Configure webhooks**: wpisz Callback URL oraz Verify Token, kliknij **Verify and save**.
4. Kliknij **Add subscriptions** przy stronie i zaznacz **`messages`**.
5. Zrestartuj `messenger-bot` (`npm start`).

## 5. Testy

```powershell
cd c:\Users\konra\Desktop\hacknation\messenger-bot
npm test
```
