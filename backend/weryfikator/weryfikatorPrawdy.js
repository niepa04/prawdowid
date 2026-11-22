// weryfikatorPrawdy.js - WERYFIKATOR PRAWDY: porównuje to, co napisał użytkownik, z notatką
// i materiałami Research Gatherera i wydaje werdykty.
//
// Zamiast oceniać wyrwane z kontekstu kawałki, model widzi naraz CAŁE zgłoszenie i CAŁY research.
// Sam wskazuje tezy użytkownika (całe zdania, słowo w słowo; pytanie zostaje pytaniem) i ocenia
// każdą z pełnym kontekstem. Kod pilnuje twardych zasad, których model 9B bywa niepewny:
// cytat musi pochodzić z tekstu użytkownika, werdykt musi być spójny ze stanowiskiem dowodów,
// ocena fact-checkera na temat rozstrzyga (z obsługą twierdzeń przeciwnych), "Brak" bez źródeł.

const { zapytajModelJson } = require('../wspolne/ollama');
const { dopasowanieOceny, oczyscMeta } = require('../wyszukiwarka_dowodow/providers/factCheckProvider');

const WERDYKTY = ['Potwierdzone', 'Fałszywe', 'Wprowadzające w błąd', 'Brak wystarczających dowodów', 'Nie podlega weryfikacji'];
const ROZSTRZYGAJACE = ['Potwierdzone', 'Fałszywe', 'Wprowadzające w błąd'];
const BRAK = 'Brak wystarczających dowodów';
// Limity i parametry modelu: config/ustawienia.js i config/modele.js
const { MAX_TEZ } = require('../../config/ustawienia');
const { ZADANIA } = require('../../config/modele');

const PROMPT = require('../../config/prompty/weryfikator');

// --- pomocnicze ---
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function zdaniaUzytkownika(tekst) {
  return String(tekst || '')
    .replace(/=====\s*\[[^\]]+\]\s*=====/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

// Cytat musi pochodzić z tekstu użytkownika. Jeśli model go przeredagował, bierzemy najbardziej
// podobne zdanie z oryginału (słowo w słowo).
function wiernyCytat(cytat, tekst) {
  const c = String(cytat || '').trim();
  if (c && norm(tekst).includes(norm(c))) return c;
  const slowaC = new Set(norm(c).split(' ').filter((w) => w.length > 2).map((w) => w.slice(0, 6)));
  let najlepsze = null;
  let wynik = 0;
  for (const z of zdaniaUzytkownika(tekst)) {
    const slowa = norm(z).split(' ').filter((w) => w.length > 2).map((w) => w.slice(0, 6));
    if (!slowa.length) continue;
    const wspolne = slowa.filter((w) => slowaC.has(w)).length;
    const s = (2 * wspolne) / (slowa.length + slowaC.size || 1);
    if (s > wynik) {
      wynik = s;
      najlepsze = z;
    }
  }
  return wynik >= 0.4 ? najlepsze : c || najlepsze;
}

// Czy cytat podany przez model naprawdę pochodzi z materiału (po ujednoliceniu interpunkcji).
// Krótkie lub zmyślone "cytaty" nie przechodzą - wtedy stanowisko nie może rozstrzygać.
function fragmentWMateriale(fragment, material) {
  const f = norm(fragment);
  if (f.split(' ').length < 3) return false;
  const tresc = norm(
    [material.tytul, ...(material.fragmenty || []), material.oceniane_twierdzenie, material.ocena_fact_checkera, material.ocena_twierdzenia_przeciwnego]
      .filter(Boolean)
      .join(' ')
  );
  if (tresc.includes(f)) return true;
  // Dopuszczamy drobne różnice: co najmniej 80% słów cytatu występuje w materiale w tej kolejności
  const slowa = f.split(' ');
  let poz = 0;
  let trafione = 0;
  for (const w of slowa) {
    const i = tresc.indexOf(w, poz);
    if (i >= 0) {
      trafione++;
      poz = i + w.length;
    }
  }
  return trafione / slowa.length >= 0.8;
}

function werdyktZOceny(ocena) {
  const o = String(ocena || '').toLowerCase();
  if (/manipul|kontekst|wprowadza|częściow|czesciow|wyrwan|przesadz/.test(o)) return 'Wprowadzające w błąd';
  if (/fałsz|falsz|nieprawd|przerobion|fake|wygenerowan|nie ma dowod/.test(o)) return 'Fałszywe';
  if (/^prawda|^prawdziw|potwierdz/.test(o)) return 'Potwierdzone';
  return null;
}

const zrodloZ = (m) => ({ source_id: m.source_id, title: m.tytul, publisher: m.wydawca, published_at: m.data_publikacji, url: m.url });

// Twarde zasady na jednej tezie (po odpowiedzi modelu)
function sprawdzTeze(t, materialy) {
  const poNr = (nr) => materialy[Number(nr) - 1];
  const dowody = (Array.isArray(t.dowody) ? t.dowody : [])
    .filter((d) => d && poNr(d.nr))
    .map((d) => {
      const material = poNr(d.nr);
      let stanowisko = ['potwierdza', 'zaprzecza'].includes(d.stanowisko) ? d.stanowisko : 'nie_rozstrzyga';
      // Stanowisko rozstrzygające musi mieć dosłowny fragment, który naprawdę jest w materiale
      if (stanowisko !== 'nie_rozstrzyga' && !fragmentWMateriale(d.fragment, material)) stanowisko = 'nie_rozstrzyga';
      return { nr: Number(d.nr), na_temat: d.na_temat === true, stanowisko, fragment: String(d.fragment || '').slice(0, 300), material };
    });
  const naTemat = dowody.filter((d) => d.na_temat);
  let werdykt = WERDYKTY.includes(t.werdykt) ? t.werdykt : BRAK;
  let uzasadnienie = String(t.uzasadnienie || '').trim();
  let metoda = 'weryfikator';

  if (t.typ === 'opinia') {
    return { werdykt: 'Nie podlega weryfikacji', uzasadnienie: uzasadnienie || 'To opinia lub ocena, a nie twierdzenie o faktach.', zrodla: [], dowody, metoda: 'opinia' };
  }
  if (werdykt === 'Nie podlega weryfikacji') werdykt = BRAK; // teza faktowa nie może być "nie do sprawdzenia"

  // 1. Ocena fact-checkera rozstrzyga (także dla twierdzenia przeciwnego), ale tylko gdy dotyczy TEJ tezy:
  //    model uznał ją za dowód rozstrzygający albo oceniane twierdzenie pasuje do cytatu tezy
  //    (ta sama miara co w wyszukiwarce, ze zgodnością liczb: "wzrost o 91% w 8 lat" nie rozstrzyga "3% w listopadzie").
  const liczby = (s) => (String(s || '').match(/\d+(?:[.,]\d+)?/g) || []);
  const liczbyZgodne = (d) => {
    const ocenione = new Set(liczby(`${d.material.oceniane_twierdzenie || ''} ${d.material.tytul || ''}`));
    return liczby(t.cytat).every((n) => ocenione.has(n));
  };
  const pasujeDoTezy = (d) =>
    liczbyZgodne(d) && (d.stanowisko !== 'nie_rozstrzyga' ||
    dopasowanieOceny([oczyscMeta(t.cytat)], { text: d.material.oceniane_twierdzenie || '', claimReview: [{ title: d.material.tytul }] }) >= 1);
  const fc =
    naTemat.find((d) => d.material.ocena_fact_checkera && pasujeDoTezy(d)) ||
    naTemat.find((d) => d.material.ocena_twierdzenia_przeciwnego && pasujeDoTezy(d));
  if (fc) {
    const przeciwne = !fc.material.ocena_fact_checkera;
    const ocena = przeciwne ? fc.material.ocena_twierdzenia_przeciwnego : fc.material.ocena_fact_checkera;
    const zOceny = werdyktZOceny(ocena);
    const docelowy = przeciwne ? { Fałszywe: 'Potwierdzone', Potwierdzone: 'Fałszywe' }[zOceny] || null : zOceny;
    if (docelowy) {
      if (docelowy !== werdykt) {
        uzasadnienie = przeciwne
          ? `${fc.material.wydawca || 'Fact-checker'} ocenił twierdzenie przeciwne („${fc.material.oceniane_twierdzenie || ''}”) jako: ${ocena}. ${docelowy === 'Potwierdzone' ? 'To, co piszesz, jest więc zgodne z jego ustaleniami.' : 'To, co piszesz, jest więc sprzeczne z jego ustaleniami.'}`
          : `${fc.material.wydawca || 'Fact-checker'} sprawdził to twierdzenie i ocenił je jako: ${ocena}. ${uzasadnienie}`.trim();
        metoda = 'ocena_fact_checkera';
      }
      werdykt = docelowy;
      const zrodla = [fc.material, ...naTemat.filter((d) => d !== fc).map((d) => d.material)].slice(0, 3);
      return { werdykt, uzasadnienie, zrodla: zrodla.map(zrodloZ), dowody, metoda };
    }
  }

  // 2. Spójność werdyktu ze stanowiskami dowodów na temat (brak potwierdzenia to nie zaprzeczenie).
  //    Wyjątek: zdarzenie nadzwyczajne bez śladu w źródłach (Fałszywe bez dowodu zaprzeczającego).
  const stanowiska = new Set(naTemat.map((d) => d.stanowisko));
  const nadzwyczajne = /zdarzeni\w* nadzwyczajn|instytucje (państwowe )?(by|informowałyby)|informowałyby o nim|najpewniej dezinformacj/i.test(uzasadnienie);
  const niespojny =
    (werdykt === 'Potwierdzone' && !stanowiska.has('potwierdza')) ||
    (werdykt === 'Fałszywe' && !stanowiska.has('zaprzecza') && !nadzwyczajne) ||
    (werdykt === 'Wprowadzające w błąd' && !stanowiska.has('potwierdza') && !stanowiska.has('zaprzecza') && !nadzwyczajne);
  if (niespojny) {
    werdykt = BRAK;
    uzasadnienie = naTemat.length
      ? 'Znalezione materiały dotyczą tematu, ale żaden nie potwierdza ani nie zaprzecza wprost temu, co piszesz. Brak potwierdzenia nie oznacza, że informacja jest fałszywa.'
      : 'Znalezione materiały nie dotyczą dokładnie tego, o co pytasz, więc nie da się tego rozstrzygnąć. Brak potwierdzenia nie oznacza, że informacja jest fałszywa.';
    metoda = 'weryfikator_brak_spojnosci';
  }

  if (werdykt === BRAK) return { werdykt, uzasadnienie: uzasadnienie || 'Nie znaleźliśmy materiałów, które rozstrzygają tę sprawę.', zrodla: [], dowody, metoda };

  // Źródła: tylko materiały na temat z rozstrzygającym stanowiskiem (najpierw wskazane przez model)
  const wskazane = (Array.isArray(t.zrodla) ? t.zrodla : []).map(poNr).filter(Boolean);
  const rozstrzygajace = naTemat.filter((d) => d.stanowisko !== 'nie_rozstrzyga').map((d) => d.material);
  const zrodla = [...new Set([...wskazane.filter((m) => rozstrzygajace.includes(m)), ...rozstrzygajace])].slice(0, 3);
  return { werdykt, uzasadnienie, zrodla: zrodla.map(zrodloZ), dowody, metoda };
}

// Werdykt ogólny z werdyktów tez (opinie i "Brak" nie przeważają nad rozstrzygniętymi)
function werdyktOgolny(tezy) {
  const r = tezy.filter((t) => ROZSTRZYGAJACE.includes(t.werdykt)).map((t) => t.werdykt);
  if (!tezy.length) return BRAK;
  if (!r.length) return tezy.every((t) => t.werdykt === 'Nie podlega weryfikacji') ? 'Nie podlega weryfikacji' : BRAK;
  if (r.includes('Wprowadzające w błąd') || (r.includes('Potwierdzone') && r.includes('Fałszywe'))) return 'Wprowadzające w błąd';
  if (r.includes('Fałszywe')) return 'Fałszywe';
  return 'Potwierdzone';
}

/**
 * @param {string} tekst - zgłoszenie po Modelu 1
 * @param {object} research - wynik zbierzResearch()
 * @returns {Promise<object>} wynik w formacie dotychczasowego modułu werdyktów (dla frontendu)
 */
async function weryfikujPrawde(tekst, research, options = {}) {
  const start = Date.now();
  const materialy = research.materialy || [];
  let odpowiedz;
  try {
    odpowiedz = await zapytajModelJson({
      system: PROMPT,
      user: [
        `DZISIAJ: ${new Date().toISOString().slice(0, 10)}`,
        `<ZGLOSZENIE>\n${String(tekst).slice(0, 6000)}\n</ZGLOSZENIE>`,
        `<NOTATKA>\n${JSON.stringify(research.notatka || {}, null, 1)}\n</NOTATKA>`,
        `<MATERIALY>\n${JSON.stringify(
          materialy.map((m) => ({
            nr: m.nr,
            typ_zrodla: m.typ_zrodla,
            wydawca: m.wydawca,
            tytul: m.tytul,
            data: m.data_publikacji,
            fragmenty: m.fragmenty,
            ocena_fact_checkera: m.ocena_fact_checkera,
            ocena_twierdzenia_przeciwnego: m.ocena_twierdzenia_przeciwnego,
            oceniane_twierdzenie: m.oceniane_twierdzenie,
          })),
          null,
          1
        )}\n</MATERIALY>`,
      ].join('\n'),
      ...ZADANIA.weryfikator,
      fetchImpl: options.fetchImpl,
    });
  } catch (err) {
    // Bez modelu nie ma weryfikacji. Nie udajemy "braku dowodów" - pipeline zamieni ten błąd
    // na komunikat, że teraz nie da się tego sprawdzić.
    err.message = `model weryfikujący nie odpowiedział (${err.message})`;
    throw err;
  }

  let tezyModelu = Array.isArray(odpowiedz?.tezy) ? odpowiedz.tezy.filter((t) => t && t.cytat).slice(0, MAX_TEZ) : [];
  if (!tezyModelu.length) {
    // Awaryjnie: każde zdanie użytkownika to teza bez rozstrzygnięcia
    tezyModelu = zdaniaUzytkownika(tekst).slice(0, MAX_TEZ).map((z) => ({ cytat: z, typ: 'fakt', werdykt: BRAK, uzasadnienie: 'Nie udało się przeprowadzić weryfikacji (model niedostępny).' }));
  }

  // Ten sam cytat dwa razy = jedna teza
  const widziane = new Set();
  const twierdzenia = [];
  for (const t of tezyModelu) {
    const cytat = wiernyCytat(t.cytat, tekst);
    if (!cytat || widziane.has(norm(cytat))) continue;
    widziane.add(norm(cytat));
    const s = sprawdzTeze(t, materialy);
    twierdzenia.push({
      claim_id: `t${twierdzenia.length + 1}`,
      claim: cytat,
      typ: t.typ === 'opinia' ? 'opinia' : 'fakt',
      sedno: typeof t.sedno === 'string' ? t.sedno : null,
      werdykt: s.werdykt,
      sila_dowodow: s.werdykt === BRAK ? 'niska' : s.metoda === 'ocena_fact_checkera' ? 'wysoka' : 'umiarkowana',
      uzasadnienie: s.uzasadnienie,
      uzyte_zrodla: s.zrodla,
      ocena_dowodow: s.dowody.map((d) => ({ nr: d.nr, na_temat: d.na_temat, stanowisko: d.stanowisko, dlaczego: d.fragment, title: d.material.tytul, url: d.material.url })),
      metoda: s.metoda,
      czy_glowny_kontekst: true,
    });
  }

  const ogolny = werdyktOgolny(twierdzenia);
  const rozstrzygniete = twierdzenia.filter((t) => ROZSTRZYGAJACE.includes(t.werdykt));
  const zrodlaMap = new Map();
  for (const t of rozstrzygniete) for (const z of t.uzyte_zrodla) if (z.url && !zrodlaMap.has(z.url)) zrodlaMap.set(z.url, z);
  const statystyki = Object.fromEntries(WERDYKTY.map((w) => [w, twierdzenia.filter((t) => t.werdykt === w).length]));

  return {
    werdykt_ogolny: ogolny,
    glowna_odpowiedz:
      twierdzenia.length === 1
        ? twierdzenia[0].uzasadnienie
        : String(odpowiedz?.podsumowanie || '').trim() || twierdzenia.map((t) => `[${t.werdykt}] ${t.uzasadnienie}`).join(' '),
    glowny_kontekst_twierdzenie: twierdzenia[0]?.claim || null,
    glowne_zrodla: [...zrodlaMap.values()].slice(0, 5),
    statystyki_werdyktow: statystyki,
    twierdzenia,
    czas_ms: Date.now() - start,
  };
}

module.exports = { weryfikujPrawde, sprawdzTeze, werdyktOgolny, wiernyCytat };
