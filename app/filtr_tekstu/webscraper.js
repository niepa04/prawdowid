// webscraper.js - pobiera stronę spod linku i zwraca sam tekst, bez znaczników HTML
//
// Bezpieczeństwo (SSRF): serwer pobiera adresy podane przez użytkownika, więc
// nie wolno mu wejść na adresy wewnętrzne: localhost, sieć lokalną ani sieć
// Tailscale (100.64.0.0/10), gdzie stoi np. serwer OCR. Każdy adres, także po
// przekierowaniu, jest sprawdzany przed pobraniem.

const dns = require('dns').promises;
const net = require('net');

const USTAWIENIA = {
  timeoutMs: 15000,
  maxBajtow: 5 * 1024 * 1024, // 5 MB HTML
  maxPrzekierowan: 5,
  userAgent: 'Mozilla/5.0 (compatible; PrawdowidBot/0.1)',
};

// Błąd, którego treść można pokazać klientowi
class BladScrapera extends Error {
  constructor(wiadomosc, status = 502) {
    super(wiadomosc);
    this.status = status;
    this.publiczny = true;
  }
}

// Zakresy adresów, na które scraper nie może wchodzić
function adresPrywatny(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT / Tailscale
      (a === 169 && b === 254) ||           // link-local
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224                              // multicast i zarezerwowane
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return adresPrywatny(v6.slice(7));
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') || // unique local (też Tailscale)
    v6.startsWith('fe80')                         // link-local
  );
}

async function sprawdzAdres(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const adresy = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true }).catch(() => {
        throw new BladScrapera(`Nie znaleziono serwera: ${host}`, 400);
      });
  if (adresy.some((a) => adresPrywatny(a.address))) {
    throw new BladScrapera(`Adres ${host} jest adresem wewnętrznym i nie może być pobrany.`, 400);
  }
}

// Kodowanie z nagłówka Content-Type albo z <meta charset>, domyślnie UTF-8
function odczytajTekst(bufor, contentType) {
  let kodowanie = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  if (!kodowanie) {
    const poczatek = Buffer.from(bufor.slice(0, 2048)).toString('latin1');
    kodowanie = /<meta[^>]+charset=["']?([\w-]+)/i.exec(poczatek)?.[1];
  }
  try {
    return new TextDecoder(kodowanie || 'utf-8').decode(bufor);
  } catch {
    return new TextDecoder('utf-8').decode(bufor);
  }
}

const ENCJE = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  bdquo: '„', rdquo: '”', ldquo: '“', lsquo: '‘', rsquo: '’', copy: '©', reg: '®', deg: '°',
};

function dekodujEncje(tekst) {
  return tekst.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (calosc, kod) => {
    if (kod[0] === '#') {
      const liczba = kod[1].toLowerCase() === 'x' ? parseInt(kod.slice(2), 16) : parseInt(kod.slice(1), 10);
      return liczba > 0 && liczba <= 0x10ffff ? String.fromCodePoint(liczba) : '';
    }
    return ENCJE[kod.toLowerCase()] ?? calosc;
  });
}

const webscraper = {
  // link: string (URL po walidacji) -> string (sam tekst strony)
  async pobierz(link) {
    const html = await this.pobierzHtml(link);
    return this.usunHtml(html);
  },

  // Pobiera surowy HTML. Przekierowania obsługujemy ręcznie, żeby sprawdzić każdy adres.
  async pobierzHtml(link) {
    let url = new URL(link);
    for (let i = 0; i <= USTAWIENIA.maxPrzekierowan; i++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BladScrapera(`Nieobsługiwany protokół: ${url.protocol}`, 400);
      }
      await sprawdzAdres(url);

      let odp;
      try {
        odp = await fetch(url, {
          redirect: 'manual',
          headers: {
            'User-Agent': USTAWIENIA.userAgent,
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'Accept-Language': 'pl,en;q=0.8',
          },
          signal: AbortSignal.timeout(USTAWIENIA.timeoutMs),
        });
      } catch (err) {
        throw new BladScrapera(`Nie udało się połączyć z ${url.host} (${err.cause?.code || err.message}).`);
      }

      if (odp.status >= 300 && odp.status < 400 && odp.headers.get('location')) {
        url = new URL(odp.headers.get('location'), url);
        continue;
      }
      if (!odp.ok) {
        throw new BladScrapera(`Strona ${url.host} zwróciła błąd HTTP ${odp.status}.`);
      }

      const typ = odp.headers.get('content-type') || '';
      if (typ && !/text\/html|application\/xhtml|text\/plain/i.test(typ)) {
        throw new BladScrapera(`Link nie prowadzi do strony z tekstem (typ: ${typ.split(';')[0]}).`, 400);
      }

      const rozmiar = Number(odp.headers.get('content-length'));
      if (rozmiar > USTAWIENIA.maxBajtow) {
        throw new BladScrapera('Strona jest za duża.', 400);
      }
      const bufor = await this.czytajZLimitem(odp);
      return odczytajTekst(bufor, typ);
    }
    throw new BladScrapera('Za dużo przekierowań.');
  },

  // Czyta body kawałkami i przerywa po przekroczeniu limitu
  async czytajZLimitem(odp) {
    const czesci = [];
    let razem = 0;
    for await (const kawalek of odp.body) {
      razem += kawalek.length;
      if (razem > USTAWIENIA.maxBajtow) {
        throw new BladScrapera('Strona jest za duża.', 400);
      }
      czesci.push(kawalek);
    }
    return Buffer.concat(czesci);
  },

  // html: string -> string (tekst bez znaczników, z zachowanymi akapitami)
  usunHtml(html) {
    return dekodujEncje(
      html
        // całe bloki, których treść nie jest tekstem strony
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
        // znaczniki blokowe -> nowa linia, żeby nie sklejać akapitów
        .replace(/<(br|hr)\b[^>]*>/gi, '\n')
        .replace(/<\/?(p|div|section|article|header|footer|main|aside|nav|li|ul|ol|tr|table|h[1-6]|blockquote|pre|figure|figcaption|dt|dd)\b[^>]*>/gi, '\n')
        // wszystkie pozostałe znaczniki
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/[ \t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },
};

module.exports = webscraper;
module.exports.BladScrapera = BladScrapera;
