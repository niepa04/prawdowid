// przypadki.js - zestaw testowy werdyktów Komy
//
// 20 tematów × 5 sformułowań = 100 zapytań, po 4 tematy na każdy z 5 werdyktów.
// Każde sformułowanie ma własny oczekiwany werdykt (przy zaprzeczeniu "nie X" werdykt się odwraca).
// Oczekiwania oparte na tym, co Koma faktycznie może znaleźć: ocenach Demagoga (baza Google),
// komunikatach gov.pl / MSZ Odyseusz i definicjach werdyktów z promptu.

const P = 'Potwierdzone';
const F = 'Fałszywe';
const W = 'Wprowadzające w błąd';
const B = 'Brak wystarczających dowodów';
const N = 'Nie podlega weryfikacji';

module.exports = [
  // ===================== POTWIERDZONE =====================
  {
    temat: 'Nawrocki prezydentem',
    kategoria: P,
    zrodlo: 'gov.pl (komunikaty KPRM, ambasad)',
    zapytania: [
      ['Karol Nawrocki jest prezydentem Polski', P],
      ['Czy Karol Nawrocki jest obecnie prezydentem RP?', P],
      ['Prezydentem Rzeczypospolitej Polskiej jest Karol Nawrocki.', P],
      ['Słyszałem, że teraz głową państwa w Polsce jest Nawrocki', P],
      ['Karol Nawrocki nie jest prezydentem Polski', F],
    ],
  },
  {
    temat: 'Bilet w Krakowie 8 zł',
    kategoria: P,
    zrodlo: 'Demagog: Prawda',
    zapytania: [
      ['W Krakowie jest najdroższy bilet godzinny w Polsce, kosztujący osiem złotych', P],
      ['Czy bilet godzinny w Krakowie kosztuje 8 zł i jest najdroższy w kraju?', P],
      ['Kraków ma najdroższy w Polsce bilet godzinny komunikacji miejskiej – 8 złotych', P],
      ['Za godzinny bilet w Krakowie płaci się aż 8 zł, najwięcej w Polsce', P],
      ['Mamy w Krakowie najdroższy bilet godzinny w Polsce, bo kosztujący aż osiem złotych', P],
    ],
  },
  {
    temat: 'Strajk generalny we Włoszech',
    kategoria: P,
    zrodlo: 'MSZ Odyseusz – Aktualności (Włochy)',
    zapytania: [
      ['We Włoszech zapowiedziano strajk generalny', P],
      ['Czy we Włoszech odbył się strajk generalny?', P],
      ['We Włoszech ostatnio odbył się strajk generalny w sektorze publicznym i prywatnym', P],
      ['Włoskie związki zawodowe zorganizowały ogólnokrajowy strajk generalny', P],
      ['Podróżni do Włoch muszą liczyć się z utrudnieniami w transporcie z powodu strajku generalnego', P],
    ],
  },
  {
    temat: 'Rosyjskie obiekty nad Polską',
    kategoria: P,
    zrodlo: 'gov.pl KPRM / MON',
    zapytania: [
      ['Rosyjskie obiekty naruszyły polską przestrzeń powietrzną', P],
      ['Czy rosyjskie obiekty wleciały w polską przestrzeń powietrzną?', P],
      ['Doszło do naruszenia polskiej przestrzeni powietrznej przez rosyjskie obiekty', P],
      ['Rząd potwierdził, że rosyjskie drony naruszyły przestrzeń powietrzną Polski', P],
      ['Rosyjskie obiekty nigdy nie naruszyły polskiej przestrzeni powietrznej', F],
    ],
  },

  // ===================== FAŁSZYWE =====================
  {
    temat: 'Szczepionki a autyzm',
    kategoria: F,
    zrodlo: 'Demagog: Fałsz',
    zapytania: [
      ['Szczepionki powodują autyzm u dzieci', F],
      ['Czy szczepionki powodują autyzm?', F],
      ['Udowodniono, że po szczepieniach dzieci zapadają na autyzm', F],
      ['Lekarze ukrywają, że szczepienia wywołują autyzm', F],
      ['Szczepionki nie powodują autyzmu', P],
    ],
  },
  {
    temat: 'ABW i ukraińscy szpiedzy',
    kategoria: F,
    zrodlo: 'Demagog: Fałsz (szpiedzy działali na rzecz Rosji)',
    zapytania: [
      ['ABW zatrzymało szpiegów działających na rzecz ukraińskich sił specjalnych', F],
      ['Czy ABW zatrzymała szpiegów pracujących dla ukraińskich służb specjalnych?', F],
      ['Agencja Bezpieczeństwa Wewnętrznego złapała ukraińskich szpiegów', F],
      ['ABW zatrzymało dwóch Ukraińców szpiegujących dla ukraińskiego wywiadu', F],
      ['Zatrzymani przez ABW szpiedzy działali na rzecz ukraińskich sił specjalnych', F],
    ],
  },
  {
    temat: 'Była miss Ukrainy obraziła Polaków',
    kategoria: F,
    zrodlo: 'Demagog: Fałsz (to nagranie z Aleksandrem Kwaśniewskim)',
    zapytania: [
      ['Była miss Ukrainy obraziła Polaków', F],
      ['Czy była miss Ukrainy obraziła Polaków?', F],
      ['Była Miss Ukrainy w wywiadzie obrażała Polskę i Polaków', F],
      ['Ukraińska miss piękności nazwała Polaków w obraźliwy sposób', F],
      ['Krąży nagranie, na którym była miss Ukrainy obraża Polaków', F],
    ],
  },
  {
    temat: 'Cesarskie cięcie a mózg',
    kategoria: F,
    zrodlo: 'Demagog: Fałsz',
    zapytania: [
      ['Dzieci urodzone cesarskim cięciem mają zauważalne różnice rozwojowe mózgu', F],
      ['Czy dzieci po cesarce mają inaczej rozwinięty mózg?', F],
      ['Cesarskie cięcie powoduje zaburzenia rozwoju mózgu u dzieci', F],
      ['Dzieci urodzone przez cesarskie cięcie mają różnice w rozwoju mózgu w porównaniu z urodzonymi naturalnie', F],
      ['Poród przez cesarskie cięcie zmienia rozwój mózgu dziecka', F],
    ],
  },

  // ===================== WPROWADZAJĄCE W BŁĄD =====================
  {
    temat: 'Pieniądze z PPK na inwestycje',
    kategoria: W,
    zrodlo: 'Demagog: Brakujący kontekst',
    zapytania: [
      ['Rząd planuje wykorzystać pieniądze zgromadzone w PPK do finansowania inwestycji publicznych', W],
      ['Czy rząd chce przejąć pieniądze z PPK na inwestycje państwowe?', W],
      ['Nasze oszczędności z PPK pójdą na państwowe projekty', W],
      ['Rząd sięgnie po środki z Pracowniczych Planów Kapitałowych, żeby finansować inwestycje', W],
      ['Pieniądze z PPK zostaną wykorzystane do finansowania inwestycji publicznych', W],
    ],
  },
  {
    temat: 'Greta Thunberg wyśmiewa protesty',
    kategoria: W,
    zrodlo: 'Demagog: Brak kontekstu',
    zapytania: [
      ['Greta Thunberg wyśmiewa protesty klimatyczne w Niemczech', W],
      ['Czy Greta Thunberg śmiała się z protestów klimatycznych w Niemczech?', W],
      ['Greta Thunberg kpi z niemieckich aktywistów klimatycznych', W],
      ['Na nagraniu Greta Thunberg wyśmiewa protest klimatyczny w Berlinie', W],
      ['Greta Thunberg drwi z protestujących w sprawie klimatu w Niemczech', W],
    ],
  },
  {
    temat: 'Panele słoneczne a ocieplenie',
    kategoria: W,
    zrodlo: 'Demagog: Brakujący kontekst',
    zapytania: [
      ['Panele słoneczne przyśpieszają globalne ocieplenie', W],
      ['Czy panele fotowoltaiczne przyspieszają globalne ocieplenie?', W],
      ['Fotowoltaika zwiększa globalne ocieplenie', W],
      ['Instalowanie paneli słonecznych przyczynia się do ocieplania klimatu', W],
      ['Panele słoneczne nagrzewają planetę i przyśpieszają zmiany klimatu', W],
    ],
  },
  {
    temat: 'Broń akustyczna pod Trybunałem',
    kategoria: W,
    zrodlo: 'Demagog: Brak kontekstu',
    zapytania: [
      ['Pod Trybunałem Konstytucyjnym umieszczono broń akustyczną', W],
      ['Czy pod Trybunałem Konstytucyjnym zainstalowano broń akustyczną?', W],
      ['Przed siedzibą Trybunału Konstytucyjnego stoi broń akustyczna', W],
      ['Policja ustawiła pod Trybunałem Konstytucyjnym urządzenie akustyczne do rozpędzania tłumu', W],
      ['Pod TK pojawiła się broń akustyczna', W],
    ],
  },

  // ===================== BRAK WYSTARCZAJĄCYCH DOWODÓW =====================
  {
    temat: 'Szkoła w Pcimiu',
    kategoria: B,
    zrodlo: 'brak informacji w źródłach (zdarzenie lokalne)',
    zapytania: [
      ['W Pcimiu wczoraj zamknięto szkołę podstawową z powodu awarii ogrzewania', B],
      ['Czy w Pcimiu zamknięto szkołę przez awarię ogrzewania?', B],
      ['Szkoła podstawowa w Pcimiu jest nieczynna z powodu zepsutego ogrzewania', B],
      ['Uczniowie z Pcimia mają wolne, bo w szkole wysiadło ogrzewanie', B],
      ['Awaria ogrzewania zamknęła szkołę w Pcimiu', B],
    ],
  },
  {
    temat: 'Ceny masła',
    kategoria: B,
    zrodlo: 'brak informacji w źródłach (statystyka)',
    zapytania: [
      ['Ceny masła w Polsce wzrosły w listopadzie o 3 procent', B],
      ['Czy masło zdrożało w listopadzie o 3%?', B],
      ['W listopadzie masło podrożało o trzy procent', B],
      ['GUS podał, że ceny masła w listopadzie wzrosły o 3 proc.', B],
      ['Za masło płacimy w listopadzie o 3 procent więcej niż w październiku', B],
    ],
  },
  {
    temat: 'Minister zdrowia o tańszych lekach',
    kategoria: B,
    zrodlo: 'brak informacji w źródłach (wypowiedź)',
    zapytania: [
      ['Minister zdrowia powiedział wczoraj, że od stycznia leki będą tańsze o połowę', B],
      ['Czy minister zdrowia zapowiedział, że leki potanieją o połowę od stycznia?', B],
      ['Od stycznia ceny leków spadną o 50 procent, zapowiedział minister zdrowia', B],
      ['Ministerstwo Zdrowia obiecuje obniżkę cen leków o połowę od nowego roku', B],
      ['Minister zdrowia: leki od stycznia o połowę tańsze', B],
    ],
  },
  {
    temat: 'Nowa piekarnia w Gdańsku',
    kategoria: B,
    zrodlo: 'brak informacji w źródłach (zdarzenie lokalne)',
    zapytania: [
      ['W Gdańsku przy ulicy Długiej otwarto nową piekarnię', B],
      ['Czy na ulicy Długiej w Gdańsku powstała nowa piekarnia?', B],
      ['Na Długiej w Gdańsku działa od tego tygodnia nowa piekarnia', B],
      ['Nowa piekarnia rzemieślnicza otworzyła się w centrum Gdańska przy Długiej', B],
      ['Gdańszczanie mogą kupić pieczywo w nowej piekarni na ulicy Długiej', B],
    ],
  },

  // ===================== NIE PODLEGA WERYFIKACJI =====================
  {
    temat: 'Najpiękniejsze miasto',
    kategoria: N,
    zrodlo: 'opinia',
    zapytania: [
      ['Kraków to najpiękniejsze miasto w Polsce', N],
      ['Moim zdaniem Kraków jest najładniejszym polskim miastem', N],
      ['Nie ma w Polsce piękniejszego miasta niż Kraków', N],
      ['Kraków jest zdecydowanie najbardziej urokliwym miastem w kraju', N],
      ['Uważam, że żadne miasto nie dorównuje urodą Krakowowi', N],
    ],
  },
  {
    temat: 'Najlepsza kuchnia',
    kategoria: N,
    zrodlo: 'opinia',
    zapytania: [
      ['Polska kuchnia jest najlepsza na świecie', N],
      ['Pierogi to najsmaczniejsze danie, jakie istnieje', N],
      ['Nic nie smakuje lepiej niż polski żurek', N],
      ['Moim zdaniem polskie jedzenie bije na głowę włoskie', N],
      ['Polska kuchnia jest smaczniejsza od francuskiej', N],
    ],
  },
  {
    temat: 'Prognoza na przyszłość',
    kategoria: N,
    zrodlo: 'prognoza / przekonanie',
    zapytania: [
      ['Za dziesięć lat Polska będzie najbogatszym krajem w Europie', N],
      ['Myślę, że przyszły rok będzie dla Polski lepszy niż ten', N],
      ['Za kilka lat wszyscy będziemy jeździć samochodami elektrycznymi', N],
      ['Moim zdaniem sztuczna inteligencja wkrótce zastąpi większość zawodów', N],
      ['Jestem przekonany, że polska gospodarka czeka świetna przyszłość', N],
    ],
  },
  {
    temat: 'Ocena wartościująca',
    kategoria: N,
    zrodlo: 'ocena wartościująca',
    zapytania: [
      ['Sport to najlepszy sposób na spędzanie wolnego czasu', N],
      ['Czytanie książek jest ciekawsze niż oglądanie filmów', N],
      ['Jesień to najpiękniejsza pora roku', N],
      ['Moim zdaniem góry są lepsze na wakacje niż morze', N],
      ['Praca zdalna jest wygodniejsza od pracy w biurze', N],
    ],
  },
];
