# 🎮 Dash Duel

Souboj dvou hráčů ve stylu **Geometry Dash**. Hraj **na jednom zařízení**
(dva hráči u jedné klávesnice) nebo **online na dvou zařízeních** přes kód hry.

Obrazovka je rozdělená na dvě poloviny. **Oba hráči stojí pravou stranou
nahoru a skáčou nahoru** — horní hráč má zem uprostřed a skáče k hornímu
okraji, dolní hráč má zem dole a skáče ke středu. Oba se vyhýbají **stejným**
bodcům. **Vyhrává ten, kdo vydrží déle.** Rychlost i hustota překážek
postupně rostou, takže běh dřív nebo později skončí.

## Hlavní menu

- **Hra na jednom zařízení** — dva hráči, jedna klávesnice (nebo dotyk)
- **Začít novou hru online** — vygeneruje se kód (4 písmena + 2 číslice), který dáš spoluhráči
- **Připojit se k existující hře** — zadáš kód od spoluhráče a hra začne

## Ovládání

### Na jednom zařízení
| Hráč | Polovina | Klávesa | Dotyk |
|------|----------|---------|-------|
| **Hráč 1** | horní | `W` | klepnutí v horní polovině |
| **Hráč 2** | dolní | šipka `↑` | klepnutí v dolní polovině |

Odveta po konci: **MEZERNÍK** (nebo klepnutí).

### Online (každý na svém zařízení)
Skok: **MEZERNÍK / šipka ↑ / W** nebo **klepnutí kamkoli**. Na svém zařízení
hraješ vždy spodní postavu, soupeře vidíš nahoře. Odveta: **MEZERNÍK** — kolo
začne, až o odvetu požádají oba.

## Spuštění

Online režim funguje přes **PeerJS (WebRTC)** — dvě zařízení se propojí
**napřímo, bez vlastního serveru**. Stačí tedy statický hosting a internet.

### Nejjednodušeji
Otevři `index.html` v prohlížeči, nebo nahraj soubory na libovolný statický
hosting (**GitHub Pages**, Netlify, Vercel…). Online i lokální režim fungují.
> Pozn.: online potřebuje připojení k internetu (propojovací služba PeerJS).
> Pokud soubor otevřeš přes `file://` na obou zařízeních bez internetu,
> funguje jen lokální hra na jednom zařízení.

### Online na dvou zařízeních
Jeden hráč zvolí **„Začít novou hru online"** → dostane kód (např. `ABCD12`),
druhý zvolí **„Připojit se"** a kód zadá. Funguje to mezi libovolnými
zařízeními s internetem (nemusí být na stejné WiFi).

### Volitelně: lokální server
Pro pohodlné lokální testování (servíruje soubory přes `http://`):
```bash
node server.js     # nebo: npm start  →  http://localhost:8000
```
Server není pro online nutný (to řeší PeerJS), jen usnadňuje místní spuštění.

## Struktura

- `index.html` — stránka, menu a HUD (+ PeerJS z CDN)
- `style.css` — vzhled, menu, animace
- `game.js` — herní logika (fyzika, deterministické překážky/mince, úrovně, zvuky, částice, PeerJS klient)
- `server.js` — volitelný statický server pro lokální spuštění
- `package.json` — `npm start`

## Vlastnosti

- Dva režimy: lokální (2 hráči) i online (kód místnosti, bez serveru přes WebRTC)
- Stejné překážky i mince pro oba hráče (deterministické dle semínka) → férový reflexní závod
- Postupně rostoucí náročnost: rychlost, hustota i výška překážek; úrovně s nápisem
- **Mince** k sbírání (risk/odměna), **zvuky** (skok, mince, náraz, odpočet, výhra) + jemná hudba, tlačítko ztlumení 🔊
- Efekty: otřes obrazovky při nárazu, barevně se měnící pozadí, částice, rotující neonová kostka
- Funguje na klávesnici i dotykově
