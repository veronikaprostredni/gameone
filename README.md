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

### Jen hra na jednom zařízení (bez serveru)
Stačí otevřít `index.html` v prohlížeči (dvojklik). Online režim takto
nefunguje — k tomu je potřeba server (viz níže).

### S online režimem (potřebný Node.js)
```bash
node server.js
# nebo:  npm start
```
Pak otevři `http://localhost:8000`.

**Hra po síti (stejná WiFi):** na druhém zařízení otevři
`http://<IP-adresa-počítače-se-serverem>:8000` (např. `http://192.168.0.10:8000`),
jeden hráč zvolí „Začít novou hru online", druhý „Připojit se" a zadá kód.

**Hra přes internet:** nasaď `server.js` na libovolný Node hosting
(Render, Railway, Fly.io, Glitch…). Server zároveň hostuje i samotnou hru,
takže veřejná adresa funguje rovnou jako odkaz pro oba hráče.
> Pozn.: GitHub Pages umí jen statické soubory, **server na něm spustit nelze** —
> proto online režim na Pages fungovat nebude (lokální hra ano).

Server běží bez instalace balíčků (čistý Node, vlastní minimalistický WebSocket),
jen potřebuje **Node.js ≥ 16**.

## Struktura

- `index.html` — stránka, menu a HUD
- `style.css` — vzhled, menu, animace
- `game.js` — herní logika (fyzika, deterministické překážky, obtížnost, částice, síťový klient)
- `server.js` — HTTP server + WebSocket pro propojení hráčů přes kód místnosti
- `package.json` — `npm start`

## Vlastnosti

- Dva režimy: lokální (2 hráči) i online (kód místnosti) ze stejného kódu
- Stejné překážky pro oba hráče (deterministické dle semínka) → férový reflexní závod
- Postupně rostoucí náročnost (rychlost i hustota překážek)
- Částicové efekty (stopa, obláček při skoku/dopadu, exploze), rotující neonová kostka
- Funguje na klávesnici i dotykově
