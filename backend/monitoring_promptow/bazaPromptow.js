// bazaPromptow.js - baza danych SQLite (node:sqlite) przechowująca zanonimizowane
// zgłoszenia użytkowników, klastry tematyczne oraz alerty podejrzanej nadaktywności.
// Wszystkie zapytania są ściśle parametryzowane (ochrona przed SQL injection).

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const ustawienia = require('../../config/ustawienia');
const {
  normalizujDoPorownania,
  hashTekstu,
  graniceCzasowe,
  bezpiecznyKluczKanoniczny,
  wyczyscBialeZnaki,
} = require('./normalizacja');

const STATUSY_ALERTU = new Set(['aktywny', 'monitorowany', 'zamkniety']);
const POZIOMY_ALERTU = new Set(['podwyzszona', 'wysoka', 'krytyczna']);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS klastry_tematyczne (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  klucz_kanoniczny TEXT NOT NULL UNIQUE,
  tytul TEXT NOT NULL,
  kanoniczne_pytanie TEXT NOT NULL,
  kategoria TEXT NOT NULL DEFAULT 'inne',
  slowa_kluczowe_json TEXT NOT NULL DEFAULT '[]',
  liczba_zgloszen INTEGER NOT NULL DEFAULT 0,
  pierwsze_zgloszenie_at TEXT NOT NULL,
  ostatnie_zgloszenie_at TEXT NOT NULL,
  utworzono_at TEXT NOT NULL,
  zaktualizowano_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompty_uzytkownikow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zewnetrzne_id TEXT UNIQUE,
  tekst_oczyszczony TEXT NOT NULL,
  tekst_znormalizowany TEXT NOT NULL,
  hash_tekstu TEXT NOT NULL,
  zrodlo_wejscia TEXT NOT NULL DEFAULT 'tekst',
  klaster_id INTEGER REFERENCES klastry_tematyczne(id) ON DELETE SET NULL,
  status_grupowania TEXT NOT NULL DEFAULT 'oczekuje',
  pewnosc_grupowania REAL,
  metoda_grupowania TEXT,
  status_weryfikacji TEXT NOT NULL DEFAULT 'w_trakcie',
  werdykt_ogolny TEXT,
  temat_researchu TEXT,
  liczba_prob_grupowania INTEGER NOT NULL DEFAULT 0,
  blad_grupowania TEXT,
  utworzono_at TEXT NOT NULL,
  pogrupowano_at TEXT
);

CREATE TABLE IF NOT EXISTS alerty_nadaktywnosci (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  klaster_id INTEGER NOT NULL UNIQUE REFERENCES klastry_tematyczne(id) ON DELETE CASCADE,
  status_alertu TEXT NOT NULL DEFAULT 'aktywny',
  poziom TEXT NOT NULL,
  powod_wykrycia TEXT NOT NULL,
  liczba_dzis INTEGER NOT NULL DEFAULT 0,
  liczba_godzina INTEGER NOT NULL DEFAULT 0,
  liczba_calkowita INTEGER NOT NULL DEFAULT 0,
  wskaznik_wzrostu REAL NOT NULL DEFAULT 1.0,
  rozklad_werdyktow_json TEXT NOT NULL DEFAULT '{}',
  naglowek_alertu TEXT NOT NULL,
  podsumowanie_sytuacyjne TEXT NOT NULL,
  obawy_spoleczne_json TEXT NOT NULL DEFAULT '[]',
  rekomendacja_komunikacyjna TEXT NOT NULL DEFAULT '',
  ocena_ryzyka_dezinformacji TEXT NOT NULL DEFAULT 'srednie',
  metoda_podsumowania TEXT NOT NULL DEFAULT 'szablon_bezpieczny',
  ostatnia_liczba_przy_podsumowaniu INTEGER NOT NULL DEFAULT 0,
  wykryto_at TEXT NOT NULL,
  zaktualizowano_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompty_status_grupowania ON prompty_uzytkownikow(status_grupowania, id);
CREATE INDEX IF NOT EXISTS idx_prompty_klaster_czas ON prompty_uzytkownikow(klaster_id, utworzono_at);
CREATE INDEX IF NOT EXISTS idx_prompty_hash ON prompty_uzytkownikow(hash_tekstu);
CREATE INDEX IF NOT EXISTS idx_prompty_utworzono ON prompty_uzytkownikow(utworzono_at);
CREATE INDEX IF NOT EXISTS idx_klastry_ostatnie ON klastry_tematyczne(ostatnie_zgloszenie_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerty_status ON alerty_nadaktywnosci(status_alertu, liczba_dzis DESC);
`;

function parsujJson(tekst, domyslna) {
  try {
    const w = JSON.parse(tekst);
    return w ?? domyslna;
  } catch {
    return domyslna;
  }
}

function mapujKlaster(w) {
  if (!w) return null;
  return {
    id: Number(w.id),
    klucz_kanoniczny: w.klucz_kanoniczny,
    tytul: w.tytul,
    kanoniczne_pytanie: w.kanoniczne_pytanie,
    kategoria: w.kategoria,
    slowa_kluczowe: parsujJson(w.slowa_kluczowe_json, []),
    liczba_zgloszen: Number(w.liczba_zgloszen || 0),
    pierwsze_zgloszenie_at: w.pierwsze_zgloszenie_at,
    ostatnie_zgloszenie_at: w.ostatnie_zgloszenie_at,
    utworzono_at: w.utworzono_at,
    zaktualizowano_at: w.zaktualizowano_at,
  };
}

function mapujAlert(w) {
  if (!w) return null;
  return {
    id: Number(w.id),
    klaster_id: Number(w.klaster_id),
    status_alertu: w.status_alertu,
    poziom: w.poziom,
    powod_wykrycia: w.powod_wykrycia,
    liczba_dzis: Number(w.liczba_dzis || 0),
    liczba_godzina: Number(w.liczba_godzina || 0),
    liczba_calkowita: Number(w.liczba_calkowita || 0),
    wskaznik_wzrostu: Number(w.wskaznik_wzrostu || 1),
    rozklad_werdyktow: parsujJson(w.rozklad_werdyktow_json, {}),
    naglowek_alertu: w.naglowek_alertu,
    podsumowanie_sytuacyjne: w.podsumowanie_sytuacyjne,
    obawy_spoleczne: parsujJson(w.obawy_spoleczne_json, []),
    rekomendacja_komunikacyjna: w.rekomendacja_komunikacyjna,
    ocena_ryzyka_dezinformacji: w.ocena_ryzyka_dezinformacji,
    metoda_podsumowania: w.metoda_podsumowania,
    ostatnia_liczba_przy_podsumowaniu: Number(w.ostatnia_liczba_przy_podsumowaniu || 0),
    wykryto_at: w.wykryto_at,
    zaktualizowano_at: w.zaktualizowano_at,
    tytul_klastra: w.tytul || undefined,
    kanoniczne_pytanie: w.kanoniczne_pytanie || undefined,
    kategoria: w.kategoria || undefined,
    pierwsze_zgloszenie_at: w.pierwsze_zgloszenie_at || undefined,
    ostatnie_zgloszenie_at: w.ostatnie_zgloszenie_at || undefined,
  };
}

function otworzPolaczenie(sciezkaDb) {
  const sciezka = sciezkaDb || ustawienia.MONITORING_DB_PATH;
  if (sciezka !== ':memory:') {
    fs.mkdirSync(path.dirname(sciezka), { recursive: true });
  }
  const db = new DatabaseSync(sciezka);
  if (sciezka !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA_SQL);
  return { db, sciezka };
}

function utworzBazePromptow(opcje = {}) {
  const strefa = opcje.strefaCzasowa || ustawienia.MONITORING_STREFA_CZASOWA || 'Europe/Warsaw';
  const { db, sciezka } = otworzPolaczenie(opcje.sciezkaDb);
  let zamknieta = false;

  let licznikSavepoint = 0;
  const wTransakcji = (fn) => {
    if (db.isTransaction) {
      const sp = `sp_${++licznikSavepoint}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        const wynik = fn();
        db.exec(`RELEASE ${sp}`);
        return wynik;
      } catch (err) {
        try {
          db.exec(`ROLLBACK TO ${sp}`);
          db.exec(`RELEASE ${sp}`);
        } catch {
          // pomijamy
        }
        throw err;
      }
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const wynik = fn();
      db.exec('COMMIT');
      return wynik;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // pomijamy
      }
      throw err;
    }
  };

  const stmtInsertPrompt = db.prepare(`
    INSERT INTO prompty_uzytkownikow (
      zewnetrzne_id, tekst_oczyszczony, tekst_znormalizowany, hash_tekstu,
      zrodlo_wejscia, status_grupowania, status_weryfikacji, utworzono_at
    ) VALUES (?, ?, ?, ?, ?, 'oczekuje', ?, ?)
  `);

  const stmtUpdateWerdykt = db.prepare(`
    UPDATE prompty_uzytkownikow
    SET status_weryfikacji = COALESCE(?, status_weryfikacji),
        werdykt_ogolny = COALESCE(?, werdykt_ogolny),
        temat_researchu = COALESCE(?, temat_researchu)
    WHERE zewnetrzne_id = ?
  `);

  function zapiszPrompt({ zewnetrzneId = null, tekstOczyszczony, zrodloWejscia = 'tekst', statusWeryfikacji = 'w_trakcie', teraz = new Date() }) {
    const czysty = wyczyscBialeZnaki(tekstOczyszczony).slice(0, 1800);
    if (!czysty) return null;
    const norm = normalizujDoPorownania(czysty);
    if (!norm) return null;
    const hash = hashTekstu(norm);
    const iso = (teraz instanceof Date ? teraz : new Date(teraz)).toISOString();

    const info = stmtInsertPrompt.run(
      zewnetrzneId ? String(zewnetrzneId).slice(0, 80) : null,
      czysty,
      norm,
      hash,
      String(zrodloWejscia || 'tekst').slice(0, 20),
      String(statusWeryfikacji || 'w_trakcie').slice(0, 30),
      iso
    );
    return {
      id: Number(info.lastInsertRowid),
      zewnetrzne_id: zewnetrzneId,
      tekst_oczyszczony: czysty,
      tekst_znormalizowany: norm,
      hash_tekstu: hash,
      utworzono_at: iso,
    };
  }

  function aktualizujWerdykt(zewnetrzneId, { statusWeryfikacji = null, werdyktOgolny = null, tematResearchu = null } = {}) {
    if (!zewnetrzneId) return false;
    const res = stmtUpdateWerdykt.run(
      statusWeryfikacji ? String(statusWeryfikacji).slice(0, 30) : null,
      werdyktOgolny ? String(werdyktOgolny).slice(0, 80) : null,
      tematResearchu ? wyczyscBialeZnaki(tematResearchu).slice(0, 200) : null,
      String(zewnetrzneId).slice(0, 80)
    );
    return Number(res.changes) > 0;
  }

  function resetujUtknietePrzetwarzanie() {
    const res = db.prepare(`UPDATE prompty_uzytkownikow SET status_grupowania = 'oczekuje' WHERE status_grupowania = 'przetwarzany'`).run();
    return Number(res.changes);
  }

  function pobierzNastepnyDoGrupowania() {
    return wTransakcji(() => {
      const w = db.prepare(`
        SELECT id, zewnetrzne_id, tekst_oczyszczony, tekst_znormalizowany, hash_tekstu,
               zrodlo_wejscia, status_weryfikacji, werdykt_ogolny, temat_researchu,
               liczba_prob_grupowania, utworzono_at
        FROM prompty_uzytkownikow
        WHERE status_grupowania = 'oczekuje'
        ORDER BY id ASC
        LIMIT 1
      `).get();
      if (!w) return null;
      db.prepare(`UPDATE prompty_uzytkownikow SET status_grupowania = 'przetwarzany' WHERE id = ?`).run(w.id);
      return {
        id: Number(w.id),
        zewnetrzne_id: w.zewnetrzne_id,
        tekst_oczyszczony: w.tekst_oczyszczony,
        tekst_znormalizowany: w.tekst_znormalizowany,
        hash_tekstu: w.hash_tekstu,
        zrodlo_wejscia: w.zrodlo_wejscia,
        status_weryfikacji: w.status_weryfikacji,
        werdykt_ogolny: w.werdykt_ogolny,
        temat_researchu: w.temat_researchu,
        liczba_prob_grupowania: Number(w.liczba_prob_grupowania || 0),
        utworzono_at: w.utworzono_at,
      };
    });
  }

  function znajdzKlasterPoHashu(hash) {
    if (!hash) return null;
    const w = db.prepare(`
      SELECT p.klaster_id, k.tytul
      FROM prompty_uzytkownikow p
      JOIN klastry_tematyczne k ON k.id = p.klaster_id
      WHERE p.hash_tekstu = ? AND p.status_grupowania = 'pogrupowany' AND p.klaster_id IS NOT NULL
      ORDER BY p.id DESC
      LIMIT 1
    `).get(hash);
    return w ? { klasterId: Number(w.klaster_id), tytul: w.tytul } : null;
  }

  function pobierzKlastryKandydatow(limit = 80) {
    const wiersze = db.prepare(`
      SELECT * FROM klastry_tematyczne
      ORDER BY ostatnie_zgloszenie_at DESC, liczba_zgloszen DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(200, Number(limit) || 80)));
    return wiersze.map(mapujKlaster);
  }

  function przeliczKlaster(klasterId, terazIso) {
    const stat = db.prepare(`
      SELECT COUNT(*) AS cnt,
             MIN(utworzono_at) AS pierwsze,
             MAX(utworzono_at) AS ostatnie
      FROM prompty_uzytkownikow
      WHERE klaster_id = ?
    `).get(klasterId);
    const cnt = Number(stat?.cnt || 0);
    db.prepare(`
      UPDATE klastry_tematyczne
      SET liczba_zgloszen = ?,
          pierwsze_zgloszenie_at = COALESCE(?, pierwsze_zgloszenie_at),
          ostatnie_zgloszenie_at = COALESCE(?, ostatnie_zgloszenie_at),
          zaktualizowano_at = ?
      WHERE id = ?
    `).run(cnt, stat?.pierwsze || null, stat?.ostatnie || null, terazIso, klasterId);
  }

  function przypiszDoIstniejacegoKlastra(promptId, klasterId, { pewnosc = 0.85, metoda = 'model_llm', teraz = new Date() } = {}) {
    const terazIso = (teraz instanceof Date ? teraz : new Date(teraz)).toISOString();
    return wTransakcji(() => {
      const klaster = db.prepare(`SELECT id FROM klastry_tematyczne WHERE id = ?`).get(klasterId);
      if (!klaster) return false;
      db.prepare(`
        UPDATE prompty_uzytkownikow
        SET klaster_id = ?, status_grupowania = 'pogrupowany',
            pewnosc_grupowania = ?, metoda_grupowania = ?, pogrupowano_at = ?
        WHERE id = ?
      `).run(klasterId, Number(pewnosc), String(metoda), terazIso, promptId);
      przeliczKlaster(klasterId, terazIso);
      return true;
    });
  }

  function utworzKlasterIPrzypisz(promptId, { tytul, kanonicznePytanie, kategoria = 'inne', slowaKluczowe = [], pewnosc = 1.0, metoda = 'nowy_klaster', teraz = new Date() }) {
    const terazIso = (teraz instanceof Date ? teraz : new Date(teraz)).toISOString();
    const czystyTytul = wyczyscBialeZnaki(tytul).slice(0, 120) || 'Nowy temat';
    const czystePytanie = wyczyscBialeZnaki(kanonicznePytanie).slice(0, 220) || czystyTytul;
    const kluczBaza = bezpiecznyKluczKanoniczny(czystyTytul);
    const slowaJson = JSON.stringify((Array.isArray(slowaKluczowe) ? slowaKluczowe : []).slice(0, 12).map(String));

    return wTransakcji(() => {
      const promptWiersz = db.prepare(`SELECT utworzono_at FROM prompty_uzytkownikow WHERE id = ?`).get(promptId);
      const czasPromptu = promptWiersz?.utworzono_at || terazIso;

      // Jeśli ten klucz kanoniczny już istnieje, dopinamy do niego zamiast dublować klaster
      const istniejacy = db.prepare(`SELECT id FROM klastry_tematyczne WHERE klucz_kanoniczny = ?`).get(kluczBaza);
      let klasterId;
      if (istniejacy) {
        klasterId = Number(istniejacy.id);
      } else {
        const res = db.prepare(`
          INSERT INTO klastry_tematyczne (
            klucz_kanoniczny, tytul, kanoniczne_pytanie, kategoria, slowa_kluczowe_json,
            liczba_zgloszen, pierwsze_zgloszenie_at, ostatnie_zgloszenie_at, utworzono_at, zaktualizowano_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `).run(kluczBaza, czystyTytul, czystePytanie, String(kategoria || 'inne'), slowaJson, czasPromptu, czasPromptu, terazIso, terazIso);
        klasterId = Number(res.lastInsertRowid);
      }

      db.prepare(`
        UPDATE prompty_uzytkownikow
        SET klaster_id = ?, status_grupowania = 'pogrupowany',
            pewnosc_grupowania = ?, metoda_grupowania = ?, pogrupowano_at = ?
        WHERE id = ?
      `).run(klasterId, Number(pewnosc), String(metoda), terazIso, promptId);
      przeliczKlaster(klasterId, terazIso);
      return klasterId;
    });
  }

  function oznaczBladGrupowania(promptId, bladMsg, maxProb = 3) {
    const w = db.prepare(`SELECT liczba_prob_grupowania FROM prompty_uzytkownikow WHERE id = ?`).get(promptId);
    const proby = Number(w?.liczba_prob_grupowania || 0) + 1;
    const status = proby >= maxProb ? 'blad' : 'oczekuje';
    db.prepare(`
      UPDATE prompty_uzytkownikow
      SET status_grupowania = ?, liczba_prob_grupowania = ?, blad_grupowania = ?
      WHERE id = ?
    `).run(status, proby, String(bladMsg || '').slice(0, 300), promptId);
    return { status, proby };
  }

  function pobierzStatystykiKlastra(klasterId, teraz = new Date()) {
    const granice = graniceCzasowe(teraz, strefa);
    const podstawowe = db.prepare(`
      SELECT
        COUNT(*) AS liczba_calkowita,
        SUM(CASE WHEN utworzono_at >= ? AND utworzono_at <= ? THEN 1 ELSE 0 END) AS liczba_dzis,
        SUM(CASE WHEN utworzono_at >= ? AND utworzono_at <= ? THEN 1 ELSE 0 END) AS liczba_godzina,
        SUM(CASE WHEN utworzono_at >= ? AND utworzono_at < ? THEN 1 ELSE 0 END) AS liczba_poprzednie_7dni
      FROM prompty_uzytkownikow
      WHERE klaster_id = ?
    `).get(
      granice.poczatekDniaIso,
      granice.terazIso,
      granice.godzinaTemuIso,
      granice.terazIso,
      granice.siedemDniTemuIso,
      granice.poczatekDniaIso,
      klasterId
    );

    const ruchDzis = db.prepare(`
      SELECT COUNT(*) AS cnt FROM prompty_uzytkownikow
      WHERE utworzono_at >= ? AND utworzono_at <= ? AND status_grupowania = 'pogrupowany'
    `).get(granice.poczatekDniaIso, granice.terazIso);

    const aktywneDniPoprzednie = db.prepare(`
      SELECT COUNT(DISTINCT substr(utworzono_at, 1, 10)) AS dni
      FROM prompty_uzytkownikow
      WHERE klaster_id = ? AND utworzono_at >= ? AND utworzono_at < ?
    `).get(klasterId, granice.siedemDniTemuIso, granice.poczatekDniaIso);

    const werdyktyRows = db.prepare(`
      SELECT
        CASE
          WHEN werdykt_ogolny IS NOT NULL AND werdykt_ogolny != '' THEN werdykt_ogolny
          WHEN status_weryfikacji = 'w_trakcie' THEN 'W trakcie analizy'
          ELSE 'Nieznany'
        END AS etykieta,
        COUNT(*) AS cnt
      FROM prompty_uzytkownikow
      WHERE klaster_id = ?
      GROUP BY etykieta
    `).all(klasterId);

    const rozkladWerdyktow = {};
    for (const r of werdyktyRows) {
      rozkladWerdyktow[r.etykieta] = Number(r.cnt);
    }

    const przyklady = db.prepare(`
      SELECT
        MAX(tekst_oczyszczony) AS tekst_oczyszczony,
        COUNT(*) AS liczba_wystapien,
        MAX(utworzono_at) AS ostatnio_at,
        MAX(werdykt_ogolny) AS werdykt_ogolny
      FROM prompty_uzytkownikow
      WHERE klaster_id = ?
      GROUP BY hash_tekstu
      ORDER BY liczba_wystapien DESC, ostatnio_at DESC
      LIMIT 15
    `).all(klasterId).map((r) => ({
      tekst: r.tekst_oczyszczony,
      liczba: Number(r.liczba_wystapien),
      ostatnio_at: r.ostatnio_at,
      werdykt_ogolny: r.werdykt_ogolny || null,
    }));

    const liczbaDzis = Number(podstawowe?.liczba_dzis || 0);
    const liczbaGodzina = Number(podstawowe?.liczba_godzina || 0);
    const liczbaCalkowita = Number(podstawowe?.liczba_calkowita || 0);
    const liczbaPoprzednie7Dni = Number(podstawowe?.liczba_poprzednie_7dni || 0);
    const dniPoprzednie = Number(aktywneDniPoprzednie?.dni || 0);
    const sredniaDziennaTlo = dniPoprzednie > 0 ? liczbaPoprzednie7Dni / dniPoprzednie : 0;
    const ruchDzisLacznie = Number(ruchDzis?.cnt || 0);

    return {
      data_dnia: granice.dataDnia,
      liczba_calkowita: liczbaCalkowita,
      liczba_dzis: liczbaDzis,
      liczba_godzina: liczbaGodzina,
      liczba_poprzednie_7dni: liczbaPoprzednie7Dni,
      dni_poprzednie: dniPoprzednie,
      srednia_dzienna_tlo: Number(sredniaDziennaTlo.toFixed(2)),
      ruch_dzis_lacznie: ruchDzisLacznie,
      udzial_dzis: ruchDzisLacznie > 0 ? Number((liczbaDzis / ruchDzisLacznie).toFixed(3)) : 0,
      rozklad_werdyktow: rozkladWerdyktow,
      przyklady,
    };
  }

  function pobierzAktywneKlastryDoDetekcji(teraz = new Date()) {
    const granice = graniceCzasowe(teraz, strefa);
    const wiersze = db.prepare(`
      SELECT DISTINCT k.*
      FROM klastry_tematyczne k
      LEFT JOIN prompty_uzytkownikow p ON p.klaster_id = k.id AND p.utworzono_at >= ?
      LEFT JOIN alerty_nadaktywnosci a ON a.klaster_id = k.id AND a.status_alertu != 'zamkniety'
      WHERE p.id IS NOT NULL OR a.id IS NOT NULL
      ORDER BY k.ostatnie_zgloszenie_at DESC
    `).all(granice.poczatekDniaIso);
    return wiersze.map(mapujKlaster);
  }

  function pobierzAlertDlaKlastra(klasterId) {
    const w = db.prepare(`SELECT * FROM alerty_nadaktywnosci WHERE klaster_id = ?`).get(klasterId);
    return mapujAlert(w);
  }

  function zapiszLubAktualizujAlert({
    klasterId,
    poziom,
    powodWykrycia,
    liczbaDzis,
    liczbaGodzina,
    liczbaCalkowita,
    wskaznikWzrostu,
    rozkladWerdyktow,
    naglowekAlertu,
    podsumowanieSytuacyjne,
    obawySpoleczne,
    rekomendacjaKomunikacyjna,
    ocenaRyzykaDezinformacji,
    metodaPodsumowania,
    liczbaPrzyPodsumowaniu,
    teraz = new Date(),
  }) {
    const terazIso = (teraz instanceof Date ? teraz : new Date(teraz)).toISOString();
    const bezpiecznyPoziom = POZIOMY_ALERTU.has(poziom) ? poziom : 'podwyzszona';
    const istniejacy = pobierzAlertDlaKlastra(klasterId);

    // Jeśli alert był zamknięty, ale nastąpił kolejny znaczący wzrost (>50%), otwieramy ponownie
    let statusAlertu = istniejacy ? istniejacy.status_alertu : 'aktywny';
    if (istniejacy && istniejacy.status_alertu === 'zamkniety' && liczbaDzis > Math.max(5, istniejacy.liczba_dzis * 1.5)) {
      statusAlertu = 'aktywny';
    }

    const rozkladJson = JSON.stringify(rozkladWerdyktow || {});
    const obawyJson = JSON.stringify(Array.isArray(obawySpoleczne) ? obawySpoleczne.slice(0, 5) : []);

    if (!istniejacy) {
      db.prepare(`
        INSERT INTO alerty_nadaktywnosci (
          klaster_id, status_alertu, poziom, powod_wykrycia,
          liczba_dzis, liczba_godzina, liczba_calkowita, wskaznik_wzrostu,
          rozklad_werdyktow_json, naglowek_alertu, podsumowanie_sytuacyjne,
          obawy_spoleczne_json, rekomendacja_komunikacyjna, ocena_ryzyka_dezinformacji,
          metoda_podsumowania, ostatnia_liczba_przy_podsumowaniu, wykryto_at, zaktualizowano_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        klasterId, statusAlertu, bezpiecznyPoziom, String(powodWykrycia),
        liczbaDzis, liczbaGodzina, liczbaCalkowita, Number(wskaznikWzrostu || 1),
        rozkladJson, String(naglowekAlertu), String(podsumowanieSytuacyjne),
        obawyJson, String(rekomendacjaKomunikacyjna || ''), String(ocenaRyzykaDezinformacji || 'srednie'),
        String(metodaPodsumowania || 'szablon_bezpieczny'), Number(liczbaPrzyPodsumowaniu ?? liczbaCalkowita),
        terazIso, terazIso
      );
    } else {
      db.prepare(`
        UPDATE alerty_nadaktywnosci
        SET status_alertu = ?, poziom = ?, powod_wykrycia = ?,
            liczba_dzis = ?, liczba_godzina = ?, liczba_calkowita = ?, wskaznik_wzrostu = ?,
            rozklad_werdyktow_json = ?, naglowek_alertu = ?, podsumowanie_sytuacyjne = ?,
            obawy_spoleczne_json = ?, rekomendacja_komunikacyjna = ?, ocena_ryzyka_dezinformacji = ?,
            metoda_podsumowania = ?, ostatnia_liczba_przy_podsumowaniu = ?, zaktualizowano_at = ?
        WHERE klaster_id = ?
      `).run(
        statusAlertu, bezpiecznyPoziom, String(powodWykrycia),
        liczbaDzis, liczbaGodzina, liczbaCalkowita, Number(wskaznikWzrostu || 1),
        rozkladJson, String(naglowekAlertu), String(podsumowanieSytuacyjne),
        obawyJson, String(rekomendacjaKomunikacyjna || ''), String(ocenaRyzykaDezinformacji || 'srednie'),
        String(metodaPodsumowania || 'szablon_bezpieczny'), Number(liczbaPrzyPodsumowaniu ?? liczbaCalkowita),
        terazIso, klasterId
      );
    }
    return pobierzAlertDlaKlastra(klasterId);
  }

  function aktualizujLicznikiAlertu(klasterId, { poziom, powodWykrycia, statystyki, wskaznikWzrostu, naglowekAlertu, teraz = new Date() }) {
    const terazIso = (teraz instanceof Date ? teraz : new Date(teraz)).toISOString();
    db.prepare(`
      UPDATE alerty_nadaktywnosci
      SET poziom = ?, powod_wykrycia = ?,
          liczba_dzis = ?, liczba_godzina = ?, liczba_calkowita = ?, wskaznik_wzrostu = ?,
          rozklad_werdyktow_json = ?, naglowek_alertu = ?, zaktualizowano_at = ?
      WHERE klaster_id = ?
    `).run(
      POZIOMY_ALERTU.has(poziom) ? poziom : 'podwyzszona',
      String(powodWykrycia),
      statystyki.liczba_dzis,
      statystyki.liczba_godzina,
      statystyki.liczba_calkowita,
      Number(wskaznikWzrostu || 1),
      JSON.stringify(statystyki.rozklad_werdyktow || {}),
      String(naglowekAlertu),
      terazIso,
      klasterId
    );
  }

  function zmienStatusAlertu(alertId, nowyStatus) {
    if (!STATUSY_ALERTU.has(nowyStatus)) return null;
    const terazIso = new Date().toISOString();
    const res = db.prepare(`UPDATE alerty_nadaktywnosci SET status_alertu = ?, zaktualizowano_at = ? WHERE id = ?`).run(
      nowyStatus,
      terazIso,
      Number(alertId)
    );
    if (!Number(res.changes)) return null;
    const w = db.prepare(`
      SELECT a.*, k.tytul, k.kanoniczne_pytanie, k.kategoria, k.pierwsze_zgloszenie_at, k.ostatnie_zgloszenie_at
      FROM alerty_nadaktywnosci a
      JOIN klastry_tematyczne k ON k.id = a.klaster_id
      WHERE a.id = ?
    `).get(Number(alertId));
    return mapujAlert(w);
  }

  function pobierzPanelMonitoringu({ teraz = new Date(), statusAlertu = 'aktywne_i_monitorowane', limit = 50 } = {}) {
    const granice = graniceCzasowe(teraz, strefa);
    const bezpiecznyLimit = Math.max(1, Math.min(200, Number(limit) || 50));

    const podsumowanieRow = db.prepare(`
      SELECT
        COUNT(*) AS zgloszenia_lacznie,
        SUM(CASE WHEN utworzono_at >= ? AND utworzono_at <= ? THEN 1 ELSE 0 END) AS zgloszenia_dzis,
        SUM(CASE WHEN utworzono_at >= ? AND utworzono_at <= ? THEN 1 ELSE 0 END) AS zgloszenia_godzina,
        SUM(CASE WHEN status_grupowania IN ('oczekuje', 'przetwarzany') THEN 1 ELSE 0 END) AS oczekujace_w_tle
      FROM prompty_uzytkownikow
    `).get(granice.poczatekDniaIso, granice.terazIso, granice.godzinaTemuIso, granice.terazIso);

    const liczbaKlastrowRow = db.prepare(`SELECT COUNT(*) AS cnt FROM klastry_tematyczne`).get();
    const aktywneAlertyRow = db.prepare(`SELECT COUNT(*) AS cnt FROM alerty_nadaktywnosci WHERE status_alertu = 'aktywny'`).get();

    let filtrStatusuSql = `a.status_alertu IN ('aktywny', 'monitorowany')`;
    const params = [];
    if (statusAlertu === 'wszystkie') {
      filtrStatusuSql = `1 = 1`;
    } else if (STATUSY_ALERTU.has(statusAlertu)) {
      filtrStatusuSql = `a.status_alertu = ?`;
      params.push(statusAlertu);
    }

    const alertyRows = db.prepare(`
      SELECT a.*, k.tytul, k.kanoniczne_pytanie, k.kategoria, k.pierwsze_zgloszenie_at, k.ostatnie_zgloszenie_at
      FROM alerty_nadaktywnosci a
      JOIN klastry_tematyczne k ON k.id = a.klaster_id
      WHERE ${filtrStatusuSql}
      ORDER BY
        CASE a.poziom WHEN 'krytyczna' THEN 0 WHEN 'wysoka' THEN 1 ELSE 2 END,
        a.liczba_dzis DESC,
        a.zaktualizowano_at DESC
      LIMIT ?
    `).all(...params, bezpiecznyLimit);

    const klastryRows = db.prepare(`
      SELECT
        k.*,
        SUM(CASE WHEN p.utworzono_at >= ? AND p.utworzono_at <= ? THEN 1 ELSE 0 END) AS liczba_dzis,
        SUM(CASE WHEN p.utworzono_at >= ? AND p.utworzono_at <= ? THEN 1 ELSE 0 END) AS liczba_godzina,
        a.id AS alert_id,
        a.status_alertu AS alert_status,
        a.poziom AS alert_poziom
      FROM klastry_tematyczne k
      LEFT JOIN prompty_uzytkownikow p ON p.klaster_id = k.id
      LEFT JOIN alerty_nadaktywnosci a ON a.klaster_id = k.id
      GROUP BY k.id
      ORDER BY liczba_dzis DESC, k.ostatnie_zgloszenie_at DESC, k.liczba_zgloszen DESC
      LIMIT ?
    `).all(granice.poczatekDniaIso, granice.terazIso, granice.godzinaTemuIso, granice.terazIso, bezpiecznyLimit);

    const klastry = klastryRows.map((r) => ({
      ...mapujKlaster(r),
      liczba_dzis: Number(r.liczba_dzis || 0),
      liczba_godzina: Number(r.liczba_godzina || 0),
      alert: r.alert_id ? { id: Number(r.alert_id), status_alertu: r.alert_status, poziom: r.alert_poziom } : null,
    }));

    return {
      podsumowanie: {
        data_dnia: granice.dataDnia,
        strefa_czasowa: strefa,
        zgloszenia_lacznie: Number(podsumowanieRow?.zgloszenia_lacznie || 0),
        zgloszenia_dzis: Number(podsumowanieRow?.zgloszenia_dzis || 0),
        zgloszenia_godzina: Number(podsumowanieRow?.zgloszenia_godzina || 0),
        oczekujace_w_tle: Number(podsumowanieRow?.oczekujace_w_tle || 0),
        aktywne_alerty: Number(aktywneAlertyRow?.cnt || 0),
        liczba_klastrow: Number(liczbaKlastrowRow?.cnt || 0),
      },
      alerty: alertyRows.map(mapujAlert),
      klastry,
    };
  }

  function pobierzSzczegolyKlastra(klasterId, teraz = new Date()) {
    const klasterRow = db.prepare(`SELECT * FROM klastry_tematyczne WHERE id = ?`).get(Number(klasterId));
    if (!klasterRow) return null;
    const klaster = mapujKlaster(klasterRow);
    const alert = pobierzAlertDlaKlastra(klaster.id);
    const statystyki = pobierzStatystykiKlastra(klaster.id, teraz);

    const warianty = db.prepare(`
      SELECT
        MAX(id) AS przykladowe_id,
        MAX(tekst_oczyszczony) AS tekst,
        COUNT(*) AS liczba_zgloszen,
        MIN(utworzono_at) AS pierwsze_at,
        MAX(utworzono_at) AS ostatnie_at,
        MAX(metoda_grupowania) AS metoda_grupowania,
        AVG(pewnosc_grupowania) AS srednia_pewnosc,
        MAX(werdykt_ogolny) AS ostatni_werdykt
      FROM prompty_uzytkownikow
      WHERE klaster_id = ?
      GROUP BY hash_tekstu
      ORDER BY liczba_zgloszen DESC, ostatnie_at DESC
      LIMIT 50
    `).all(klaster.id).map((r) => ({
      tekst: r.tekst,
      liczba_zgloszen: Number(r.liczba_zgloszen),
      pierwsze_at: r.pierwsze_at,
      ostatnie_at: r.ostatnie_at,
      metoda_grupowania: r.metoda_grupowania,
      srednia_pewnosc: r.srednia_pewnosc != null ? Number(Number(r.srednia_pewnosc).toFixed(2)) : null,
      ostatni_werdykt: r.ostatni_werdykt || null,
    }));

    return { klaster, alert, statystyki, warianty };
  }

  function statystykiKolejki() {
    const rows = db.prepare(`
      SELECT status_grupowania, COUNT(*) AS cnt
      FROM prompty_uzytkownikow
      GROUP BY status_grupowania
    `).all();
    const mapa = { oczekuje: 0, przetwarzany: 0, pogrupowany: 0, blad: 0 };
    for (const r of rows) mapa[r.status_grupowania] = Number(r.cnt);
    return mapa;
  }

  function zamknij() {
    if (zamknieta) return;
    zamknieta = true;
    db.close();
  }

  return {
    sciezka,
    strefa,
    db,
    zapiszPrompt,
    aktualizujWerdykt,
    resetujUtknietePrzetwarzanie,
    pobierzNastepnyDoGrupowania,
    znajdzKlasterPoHashu,
    pobierzKlastryKandydatow,
    przypiszDoIstniejacegoKlastra,
    utworzKlasterIPrzypisz,
    oznaczBladGrupowania,
    pobierzStatystykiKlastra,
    pobierzAktywneKlastryDoDetekcji,
    pobierzAlertDlaKlastra,
    zapiszLubAktualizujAlert,
    aktualizujLicznikiAlertu,
    zmienStatusAlertu,
    pobierzPanelMonitoringu,
    pobierzSzczegolyKlastra,
    statystykiKolejki,
    zamknij,
  };
}

module.exports = { utworzBazePromptow, STATUSY_ALERTU, POZIOMY_ALERTU };
