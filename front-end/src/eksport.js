import { bezpiecznyUrl } from './api.js';

function pobierzPlik(nazwa, zawartosc, typMime) {
  const blob = new Blob([zawartosc], { type: typMime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nazwa;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dzisiaj() {
  return new Date().toISOString().slice(0, 10);
}

function zbierzLinkiZrodel(wynik) {
  const dem = wynik.demagog || {};
  const zTwierdzen = (dem.twierdzenia || []).flatMap((t) => t.uzyte_zrodla || []);
  const wszystkie = [...(dem.glowne_zrodla || []), ...zTwierdzen];
  const unikalne = [];
  const widziane = new Set();
  for (const z of wszystkie) {
    const url = bezpiecznyUrl(z?.url);
    if (!url || widziane.has(url)) continue;
    widziane.add(url);
    unikalne.push(url);
    if (unikalne.length >= 3) break;
  }
  return unikalne;
}

export function budujTekstDoKopiowania(wynik, watki) {
  const dem = wynik.demagog || {};
  const nazwa = dem.werdykt_ogolny || wynik.werdykt_ogolny || 'Brak wystarczających dowodów';
  const naglowek =
    watki.length > 1
      ? [
          `Koma – werdykt ogólny: ${nazwa}`,
          ...watki.map((x, i) => `${i + 1}. „${x.glowne.claim}” – ${x.glowne.werdykt}. ${x.glowne.uzasadnienie || ''}`),
        ].join('\n')
      : `Koma: ${nazwa}\n${dem.glowna_odpowiedz || ''}`.trim();

  const linki = zbierzLinkiZrodel(wynik);
  if (!linki.length) return naglowek;
  return `${naglowek}\n\nŹródła:\n${linki.map((l) => `- ${l}`).join('\n')}`;
}

export function pobierzRaportJson(wynik, zgloszenie) {
  const raport = {
    wygenerowano: new Date().toISOString(),
    zgloszenie: {
      tekst: zgloszenie?.tekst || wynik.tekst || '',
      liczba_zdjec: (zgloszenie?.zdjecia || []).length,
    },
    status: wynik.status,
    werdykt_ogolny: wynik.demagog?.werdykt_ogolny || wynik.werdykt_ogolny,
    podsumowanie: wynik.demagog?.glowna_odpowiedz || '',
    twierdzenia: wynik.demagog?.twierdzenia || [],
    zrodla_glowne: wynik.demagog?.glowne_zrodla || [],
    notatka_analizy: wynik.research?.notatka || null,
    metadane: wynik.metadane || null,
  };
  pobierzPlik(`koma-raport-${dzisiaj()}.json`, JSON.stringify(raport, null, 2), 'application/json;charset=utf-8');
}

function komorkaCsv(wartosc) {
  const s = String(wartosc ?? '').replace(/\r?\n/g, ' ');
  return `"${s.replace(/"/g, '""')}"`;
}

export function pobierzRaportCsv(wynik) {
  const dem = wynik.demagog || {};
  const twierdzenia = dem.twierdzenia || [];
  const wiersze = twierdzenia.length
    ? twierdzenia.map((t) => [
        t.claim,
        t.werdykt,
        t.sila_dowodow || '',
        t.uzasadnienie || '',
        (t.uzyte_zrodla || []).map((z) => z.url).filter(Boolean).join('; '),
      ])
    : [[
        dem.glowny_kontekst_twierdzenie || wynik.tekst || '',
        dem.werdykt_ogolny || wynik.werdykt_ogolny || '',
        '',
        dem.glowna_odpowiedz || '',
        (dem.glowne_zrodla || []).map((z) => z.url).filter(Boolean).join('; '),
      ]];

  const naglowek = ['Twierdzenie', 'Werdykt', 'Sila_podstawy', 'Uzasadnienie', 'Zrodla'];
  const csv = [naglowek, ...wiersze].map((w) => w.map(komorkaCsv).join(',')).join('\r\n');
  pobierzPlik(`koma-raport-${dzisiaj()}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}
