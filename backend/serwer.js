// serwer.js - serwer Komy (Express): strona, API /api/weryfikuj, /api/alerty i /api/status.
// Sprawdzanie: ekstrakcja treści -> ochrona danych osobowych -> filtr wstępny
//              -> Research Gatherer (+ wyszukiwarka dowodów) -> Weryfikator Prawdy (pipeline.js)
// Monitoring i alarmowanie: backend/monitoring_promptow/ (zapis w SQLite, grupowanie AI i wykrywanie
//                           nadaktywności działają całkowicie w tle poza ścieżką odpowiedzi HTTP).
// Ustawienia (port, limity, modele, prompty, źródła): folder config/ w głównym katalogu.

// Ustawienia lokalne (np. GOOGLE_FACTCHECK_API_KEY) z pliku .env w głównym folderze.
// Musi być przed require modułów, bo część z nich czyta zmienne środowiskowe przy wczytaniu.
// Zmienne ustawione w terminalu mają pierwszeństwo przed .env.
try {
  process.loadEnvFile(require('path').join(__dirname, '..', '.env'));
} catch {
  // brak pliku .env - działamy na zmiennych z terminala
}

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { obslugaBledow, BladWalidacji } = require('./wspolne/zabezpieczenia');
const { uruchomPipeline } = require('./pipeline');
const { createSourceRegistry } = require('./wyszukiwarka_dowodow/sourceRegistry');
const { pobierzDomyslnyMonitoring, STATUSY_ALERTU } = require('./monitoring_promptow');
const { utworzDziennik, limitZapytan } = require('./wspolne/dziennikSprawdzen');

const { PORT, HOST, MAX_CZAS_SPRAWDZENIA_MS } = require('../config/ustawienia');

const FOLDER_STRONY = path.join(__dirname, '..', 'front-end', 'dist');
const DOZWOLONE_FILTRY_ALERTOW = new Set(['aktywny', 'monitorowany', 'zamkniety', 'wszystkie', 'aktywne_i_monitorowane']);

function utworzSerwer(opcje = {}) {
  const app = express();
  const stronaZbudowana = fs.existsSync(path.join(FOLDER_STRONY, 'index.html'));
  const pobierzMonitoring = () => (opcje.monitoring !== undefined ? opcje.monitoring : pobierzDomyslnyMonitoring());

  app.disable('x-powered-by');
  // "tailscale serve" działa jako lokalne proxy, ufamy tylko nagłówkom X-Forwarded-* z localhosta
  app.set('trust proxy', 'loopback');

  // Jedno zapytanie może zawierać do 10 zdjęć po 5 MB (w Base64 ~4/3 większe), stąd 70 MB
  const jsonZapytanie = express.json({ limit: '70mb', strict: true });
  const jsonMaly = express.json({ limit: '16kb', strict: true });

  if (stronaZbudowana) {
    app.use(
      express.static(FOLDER_STRONY, {
        index: 'index.html',
        setHeaders: (res, sciezka) => {
          res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(sciezka) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      })
    );
    app.get('/alarmy', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(FOLDER_STRONY, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      res
        .type('html')
        .send(
          '<!doctype html><meta charset="utf-8"><title>Koma</title>' +
            '<body style="font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.5">' +
            '<h1>Koma – serwer działa</h1><p>Strona nie jest jeszcze zbudowana. W głównym folderze projektu uruchom ' +
            '<code>npm run build</code> i odśwież tę stronę.</p><p>API: <code>POST /api/weryfikuj</code>, ' +
            '<a href="/api/status">/api/status</a>, <a href="/api/alerty">/api/alerty</a></p></body>'
        );
    });
  }

  // Status serwera, podpiętych modułów i kolejki monitoringu w tle
  app.get('/api/status', (req, res) => {
    let zrodla = null;
    try {
      const reg = createSourceRegistry();
      zrodla = { lacznie: reg.allSources.length, aktywne: reg.enabledSources.length };
    } catch (err) {
      zrodla = { blad: err.message };
    }
    const mon = pobierzMonitoring();
    res.json({
      status: 'ok',
      app: 'prawdowid',
      pipeline: ['ekstrakcja_tresci', 'ochrona_danych_osobowych', 'filtr_wstepny', 'research_gatherer', 'wyszukiwarka_dowodow', 'weryfikator_prawdy'],
      zrodla_oficjalne: zrodla,
      monitoring: mon ? mon.statystykiKolejki() : { aktywny: false },
    });
  });

  // Lista zaufanych źródeł dla strony "Zaufane źródła" - prosto z config/zrodla/
  // (katalog źródeł, fact-checkerzy, opis Google Fact Check Tools API, wymagania dla nowych źródeł)
  app.get('/api/zrodla', (req, res) => {
    const { factCheckerzy, kryteria } = require('../config').zrodla;
    const reg = createSourceRegistry();
    const oficjalne = reg.enabledSources
      .filter((s) => s.category !== 'fact_checking')
      .map((s) => ({
        id: s.source_id,
        nazwa: s.name,
        url: s.url.split('#')[0],
        domena: s.hostname,
        kategoria: s.category,
        kategoria_nazwa: kryteria.kategorie[s.category] || s.category,
        rola: kryteria.role[s.source_role] || s.source_role || null,
      }));
    res.json({
      wstep: kryteria.wstep,
      oficjalne,
      kategorie: kryteria.kategorie,
      fact_checkerzy: factCheckerzy.zaufani.map((domena) => ({
        domena,
        url: `https://${domena}/`,
        czytamy_artykuly: factCheckerzy.przegladani.includes(domena),
      })),
      fact_check_api: {
        ...kryteria.fact_check_api,
        jezyk: factCheckerzy.google_fact_check_api.jezyk,
        // tylko informacja, czy klucz jest ustawiony - nigdy sam klucz
        aktywne: Boolean(process.env.GOOGLE_FACTCHECK_API_KEY),
      },
      wymagania: kryteria.wymagania,
    });
  });

  // Panel monitoringu trendów i alertów podejrzanej nadaktywności
  app.get('/api/alerty', (req, res) => {
    const mon = pobierzMonitoring();
    const status = req.query.status ? String(req.query.status) : 'aktywne_i_monitorowane';
    if (!DOZWOLONE_FILTRY_ALERTOW.has(status)) {
      throw new BladWalidacji('Nieprawidłowy parametr "status".');
    }
    const limitRaw = req.query.limit !== undefined ? Number(req.query.limit) : 50;
    if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > 200) {
      throw new BladWalidacji('Parametr "limit" musi być liczbą od 1 do 200.');
    }
    res.json(mon.pobierzPanel({ statusAlertu: status, limit: Math.floor(limitRaw) }));
  });

  // Wymuszenie natychmiastowego przejrzenia kolejki tła (np. w panelu analitycznym)
  app.post('/api/alerty/analizuj', async (req, res) => {
    const mon = pobierzMonitoring();
    const wynik = await mon.przetworzWszystkoTeraz({ wymusPodsumowanie: true });
    res.json({ ok: true, ...wynik, panel: mon.pobierzPanel() });
  });

  // Szczegóły konkretnego klastra tematycznego oraz pogrupowanych wariantów pytań
  app.get('/api/alerty/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!/^\d+$/.test(req.params.id) || id < 1) {
      throw new BladWalidacji('Identyfikator klastra musi być dodatnią liczbą całkowitą.');
    }
    const szczegoly = pobierzMonitoring().pobierzSzczegoly(id);
    if (!szczegoly) return res.status(404).json({ blad: 'Nie znaleziono tematu.' });
    return res.json(szczegoly);
  });

  // Zmiana statusu alertu (aktywny / monitorowany / zamkniety)
  const obsluzZmianeStatusu = (req, res) => {
    const id = Number(req.params.id);
    if (!/^\d+$/.test(req.params.id) || id < 1) {
      throw new BladWalidacji('Identyfikator alertu musi być dodatnią liczbą całkowitą.');
    }
    const status = req.body && typeof req.body.status === 'string' ? req.body.status.trim() : '';
    if (!STATUSY_ALERTU.has(status)) {
      throw new BladWalidacji('Pole "status" musi mieć wartość: aktywny, monitorowany albo zamkniety.');
    }
    const zaktualizowany = pobierzMonitoring().zmienStatusAlertu(id, status);
    if (!zaktualizowany) return res.status(404).json({ blad: 'Nie znaleziono alertu.' });
    return res.json({ ok: true, alert: zaktualizowany });
  };
  app.post('/api/alerty/:id/status', jsonMaly, obsluzZmianeStatusu);
  app.patch('/api/alerty/:id/status', jsonMaly, obsluzZmianeStatusu);

  // POST /api/weryfikuj - główna weryfikacja (monitoring działa w tle i nie opóźnia odpowiedzi)
  const dziennik = opcje.dziennik !== undefined ? opcje.dziennik : utworzDziennik();
  if (dziennik) {
    dziennik.wyczyscStare();
    setInterval(() => dziennik.wyczyscStare(), 24 * 3600 * 1000).unref();
  }

  // DELETE /api/sprawdzenia/:id - usunięcie zapisu sprawdzenia (sesji demonstracyjnej) z dziennika
  app.delete('/api/sprawdzenia/:id', (req, res) => {
    if (!dziennik || !/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ blad: 'Nie znaleziono.' });
    res.json({ usunieto: dziennik.usun(req.params.id) });
  });

  app.post('/api/weryfikuj', limitZapytan(), jsonZapytanie, async (req, res) => {
    const start = Date.now();
    let stoper;
    const limit = new Promise((_, odrzuc) => {
      stoper = setTimeout(() => {
        const blad = new Error('Sprawdzanie trwało zbyt długo (serwer modeli jest przeciążony). Spróbuj ponownie za chwilę.');
        blad.status = 504;
        blad.publiczny = true;
        odrzuc(blad);
      }, MAX_CZAS_SPRAWDZENIA_MS);
    });
    let wynik;
    try {
      wynik = await Promise.race([uruchomPipeline(req.body, { monitoringImpl: pobierzMonitoring() }), limit]);
    } finally {
      clearTimeout(stoper);
    }

    console.log(
      `[KOMA] /api/weryfikuj -> werdykt="${wynik.werdykt_ogolny}" | status=${wynik.status} | tez=${wynik.metadane.liczba_twierdzen} | materiałów=${wynik.metadane.liczba_dowodow} | czasy: M1=${wynik.model1.czas_ms}ms RESEARCH=${wynik.research?.czas_ms ?? 0}ms WERYFIKATOR=${wynik.demagog?.czas_ms ?? 0}ms`
    );

    if (dziennik) {
      try {
        wynik.id_sprawdzenia = dziennik.zapisz(req.body, wynik, { kanal: String(req.get('x-koma-kanal') || 'www').slice(0, 20), czasMs: Date.now() - start });
      } catch (e) {
        console.error('[KOMA] Nie udało się zapisać dziennika:', e.message);
      }
    }
    res.json(wynik);
  });

  app.use((req, res) => {
    res.status(404).json({ blad: 'Nie znaleziono.' });
  });

  app.use(obslugaBledow);
  return app;
}

const app = utworzSerwer();
app.utworzSerwer = utworzSerwer;

// Adresy Tailscale mieszczą się w zakresie 100.64.0.0/10
function adresyTailscale() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
    .filter((ip) => {
      const [a, b] = ip.split('.').map(Number);
      return a === 100 && b >= 64 && b <= 127;
    });
}

if (require.main === module) {
  const stronaZbudowana = fs.existsSync(path.join(FOLDER_STRONY, 'index.html'));
  const monitoring = pobierzDomyslnyMonitoring();
  monitoring.startujWorkerTla();

  const server = app.listen(PORT, HOST, () => {
    console.log(`Serwer KOMA działa na http://localhost:${PORT}`);
    console.log(stronaZbudowana
      ? 'Strona Koma: zbudowana wersja z front-end/dist (po zmianach we frontendzie: npm run build)'
      : 'Strona Koma nie jest zbudowana - zbuduj ją: npm run build');
    console.log(`Monitoring tła:     ${monitoring.aktywny ? 'aktywny (SQLite + qwen3.5:9b)' : 'wyłączony'}`);
    if (HOST === '0.0.0.0') {
      const ts = adresyTailscale();
      if (ts.length) {
        ts.forEach((ip) => console.log(`Tailscale:          http://${ip}:${PORT}`));
      } else {
        console.log('Nie wykryto adresu Tailscale - czy Tailscale jest włączony?');
      }
    }
  });
  // Limit połączenia musi być dłuższy niż limit samego sprawdzania (OCR + research + weryfikator)
  server.requestTimeout = MAX_CZAS_SPRAWDZENIA_MS + 2 * 60 * 1000;

  const zamknijCzysto = async () => {
    server.close();
    await monitoring.zamknij().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', zamknijCzysto);
  process.once('SIGTERM', zamknijCzysto);
}

module.exports = app;
