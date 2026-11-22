# AI Image Detector (Smaug-AI-Image-Detector-GGUF)

Osobny mikroserwis HTTP z endpointem `POST /api/detect-ai`, który przyjmuje obraz w base64 (czysty base64 lub `data:image/...;base64,...`) i zwraca procentowe prawdopodobieństwo wygenerowania obrazu przez AI.

## Ważna uwaga o `Smaug-AI-Image-Detector-GGUF` i Ollama vs `llama-server`

Model `hf.co/abacusai/Smaug-AI-Image-Detector-GGUF:Q8_0` jest enkoderem embeddingów + głowicą klasyfikacyjną (`head.json`, 768 wag).  
W Ollamie (`http://konrad:11434`):
- `/api/generate` odrzuca ten model (`does not support generate`),
- `/api/embed` ignoruje pole `images` (zwraca ten sam wektor niezależnie od obrazu).

Dlatego na urządzeniu `konrad` (w sieci Tailscale) uruchom `llama-server` (`llama.cpp`) z projektorem wizyjnym `--mmproj`:

```bash
llama-server -m Smaug-AI-Image-Detector-Q8_0.gguf --mmproj mmproj-Smaug-AI-Image-Detector-Q8_0.gguf --embeddings --pooling mean --image-max-tokens 140 --host 0.0.0.0 --port 8080
```

## Uruchomienie serwisu

```bash
cp .env.example .env
npm install
npm start
```

Domyślnie serwer nasłuchuje na `http://localhost:4000` i łączy się z `http://konrad:8080`.

## Endpointy

- `GET /api/health` — sprawdza połączenie z `llama-server` na `konrad:8080` i obecność `media_marker`.
- `POST /api/detect-ai` — przyjmuje JSON:

```json
{
  "image": "data:image/png;base64,iVBORw0KGgo...",
  "crops": 3
}
```

Przykładowa odpowiedź:

```json
{
  "ai_probability": 0.9412,
  "ai_percent": 94.1,
  "human_percent": 5.9,
  "label": "ai",
  "crops": 3,
  "model": "abacusai/Smaug-AI-Image-Detector-GGUF:Q8_0",
  "elapsed_ms": 412
}
```
