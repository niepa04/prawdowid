const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceRegistry } = require('../sourceRegistry');
const { routeClaimToSources } = require('../sourceRouter');

const registry = createSourceRegistry();

test('7. Dobór źródeł do twierdzenia o pogodzie (IMGW meteo, RCB, gov.pl ostrzeżenia)', () => {
  const claim = {
    id: 'k1',
    claim: 'IMGW wydało ostrzeżenie o intensywnych opadach i silnym wietrze.',
    type: 'event',
    related_to: [],
  };
  const routing = routeClaimToSources(claim, [claim], registry);
  const ids = routing.selectedSources.map((s) => s.source_id);

  assert.equal(routing.noSuitableSource, false);
  assert.ok(routing.matchedCategories.includes('environment_weather_hydro'));
  assert.ok(ids.includes('SRC034'), `Oczekiwano IMGW meteo (SRC034), otrzymano: ${ids}`);
  assert.ok(ids.includes('SRC002'), `Oczekiwano gov.pl ostrzeżenia (SRC002), otrzymano: ${ids}`);
  assert.ok(ids.includes('SRC037') || ids.includes('SRC005'), `Oczekiwano RCB, otrzymano: ${ids}`);
  // Nie powinno wysyłać do wszystkich 40 źródeł ani stron kontaktowych
  assert.ok(ids.length <= 6);
  assert.ok(!ids.includes('SRC018'));
  assert.ok(!ids.includes('SRC019'));
});

test('8. Dobór źródeł do twierdzenia o cyberbezpieczeństwie (CERT Polska)', () => {
  const claim = {
    id: 'k1',
    claim: 'CERT Polska ostrzega przed nową kampanią phishingową podszywającą się pod banki.',
    type: 'event',
    related_to: [],
  };
  const routing = routeClaimToSources(claim, [claim], registry);
  const ids = routing.selectedSources.map((s) => s.source_id);

  assert.equal(routing.noSuitableSource, false);
  assert.ok(routing.matchedCategories.includes('cybersecurity'));
  assert.equal(ids[0], 'SRC014', `CERT Polska (SRC014) powinien być źródłem nr 1, otrzymano: ${ids}`);
});

test('9. Dobór źródeł do twierdzenia o utrudnieniach drogowych (GDDKiA + RSO)', () => {
  const claim = {
    id: 'k1',
    claim: 'Na autostradzie A1 występuje poważne utrudnienie drogowe po wypadku.',
    type: 'event',
    related_to: [],
  };
  const routing = routeClaimToSources(claim, [claim], registry);
  const ids = routing.selectedSources.map((s) => s.source_id);

  assert.equal(routing.noSuitableSource, false);
  assert.ok(routing.matchedCategories.includes('transport_infrastructure'));
  assert.ok(
    ids.includes('SRC020') || ids.includes('SRC021') || ids.includes('SRC022'),
    `Oczekiwano źródeł GDDKiA, otrzymano: ${ids}`
  );
  assert.ok(ids.includes('SRC002'), `Oczekiwano również działającego gov.pl RSO (SRC002), otrzymano: ${ids}`);
  assert.ok(!ids.includes('SRC019'), 'Strona kontaktowa nie może być dobierana do incydentu drogowego');
});

test('Dobór źródeł uwzględnia relację related_to i lokalizację regionalną (Mazowieckie)', () => {
  const claims = [
    { id: 'k1', claim: 'Wprowadzono ostrzeżenie przed silnym wiatrem.', type: 'event', related_to: [] },
    { id: 'k2', claim: 'Ostrzeżenie dotyczy województwa mazowieckiego.', type: 'location', related_to: ['k1'] },
  ];
  const routingK2 = routeClaimToSources(claims[1], claims, registry);
  const ids = routingK2.selectedSources.map((s) => s.source_id);

  assert.equal(routingK2.noSuitableSource, false);
  assert.ok(ids.includes('SRC003'), `Oczekiwano ostrzeżeń mazowieckich (SRC003), otrzymano: ${ids}`);
});

test('Brak odpowiedniego źródła w katalogu dla tematu spoza zakresu 40 instytucji', () => {
  const claim = {
    id: 'k1',
    claim: 'Film o kosmitach zdobył nagrodę aktorską na festiwalu w Cannes w 1998 roku.',
    type: 'event',
    related_to: [],
  };
  const routing = routeClaimToSources(claim, [claim], registry);
  assert.equal(routing.noSuitableSource, true);
  assert.equal(routing.selectedSources.length, 0);
});
