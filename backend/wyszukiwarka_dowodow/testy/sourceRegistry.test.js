const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSourceRegistry, SourceRegistryError } = require('../sourceRegistry');

test('1. Prawidłowe wczytanie wszystkich 40 oficjalnych źródeł z katalogu', () => {
  const registry = createSourceRegistry();

  assert.equal(registry.allSources.length, 41); // 40 źródeł rządowych + Demagog
  assert.equal(registry.enabledSources.length, 41);
  assert.equal(registry.disabledSources.length, 0);
  assert.ok(registry.allowedHosts.has('www.gov.pl'));
  assert.ok(registry.allowedHosts.has('moje.cert.pl'));
  assert.ok(registry.allowedHosts.has('monitoring.paa.gov.pl'));
  assert.ok(registry.allowedHosts.has('powietrze.gios.gov.pl'));
  assert.ok(registry.allowedHosts.has('meteo.imgw.pl'));
  assert.equal(registry.getSourceById('SRC014').hostname, 'moje.cert.pl');
  assert.equal(registry.getSourceById('SRC014').discovered_feed_url, 'https://moje.cert.pl/advisories/feed/');
});

test('2. Brak pliku JSON rzuca SourceRegistryError (REGISTRY_FILE_MISSING)', () => {
  assert.throws(
    () => createSourceRegistry({ registryPath: path.join(os.tmpdir(), 'nieistniejacy_katalog_koma_12345.json') }),
    (err) => err instanceof SourceRegistryError && err.code === 'REGISTRY_FILE_MISSING'
  );
});

test('3. Błędna struktura JSON (uszkodzony JSON i brak pola sources / brak enabled) rzuca błąd', () => {
  const tmpBadJson = path.join(os.tmpdir(), `koma_bad_${Date.now()}.json`);
  fs.writeFileSync(tmpBadJson, '{ niepoprawny json', 'utf8');
  try {
    assert.throws(
      () => createSourceRegistry({ registryPath: tmpBadJson }),
      (err) => err instanceof SourceRegistryError && err.code === 'REGISTRY_INVALID_JSON'
    );
  } finally {
    fs.rmSync(tmpBadJson, { force: true });
  }

  assert.throws(
    () => createSourceRegistry({ catalogData: { schema_version: 1, sources: [] } }),
    (err) => err instanceof SourceRegistryError && err.code === 'REGISTRY_INVALID_SCHEMA'
  );

  assert.throws(
    () => createSourceRegistry({ catalogData: { sources: [{ url: 'https://www.gov.pl/web/rcb' }] } }),
    (err) => err instanceof SourceRegistryError && err.code === 'REGISTRY_INVALID_SCHEMA'
  );
});

test('4. Źródło wyłączone (enabled: false) nie trafia do aktywnych ani na listę dozwolonych hostów', () => {
  const registry = createSourceRegistry({
    catalogData: {
      schema_version: 1,
      sources: [
        { url: 'https://moje.cert.pl/komunikaty/', enabled: true },
        { url: 'https://policja.pl/pol/aktualnosci', enabled: false },
      ],
    },
  });

  assert.equal(registry.allSources.length, 2);
  assert.equal(registry.enabledSources.length, 1);
  assert.equal(registry.disabledSources.length, 1);
  assert.equal(registry.isUrlAllowed('https://moje.cert.pl/komunikaty/test'), true);
  assert.equal(registry.isUrlAllowed('https://policja.pl/pol/aktualnosci'), false);
});

test('5. Odrzucenie niezatwierdzonej domeny oraz niezatwierdzonej subdomeny', () => {
  const registry = createSourceRegistry();

  assert.equal(registry.isUrlAllowed('https://pl.wikipedia.org/wiki/Polska'), false);
  assert.equal(registry.isUrlAllowed('https://przykladowy-blog.pl/wpis'), false);
  // Subdomeny nieobecne w katalogu NIE mogą być automatycznie dopuszczane:
  assert.equal(registry.isUrlAllowed('https://api.gios.gov.pl/pjp-api/rest/station/findAll'), false);
  assert.equal(registry.isUrlAllowed('https://danepubliczne.imgw.pl/api/data/synop'), false);
  assert.equal(registry.isUrlAllowed('https://subdomena.gov.pl/ostrzezenia'), false);
  // Podstrona zatwierdzonego hosta jest dozwolona:
  assert.equal(registry.isUrlAllowed('https://www.gov.pl/web/rcb/komunikat-123'), true);
});
