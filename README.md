# 🎮 Dash Duel

Lokální souboj dvou hráčů u jednoho počítače ve stylu **Geometry Dash**.

Obrazovka je rozdělená na dvě poloviny. **Horní hráč** běží po stropě
(gravitace ho táhne nahoru), **dolní hráč** běží po zemi. Oba skáčou směrem
ke středu a vyhýbají se stejným bodcům. **Vyhrává ten, kdo vydrží déle.**

## Ovládání

| Hráč | Polovina | Klávesa | Dotyk / myš |
|------|----------|---------|-------------|
| **Hráč 1** | horní | `W` | klepnutí v horní polovině |
| **Hráč 2** | dolní | šipka `↑` | klepnutí v dolní polovině |

Start a odveta: **MEZERNÍK** (nebo klepnutí na obrazovku).

## Jak hrát

1. Otevři `index.html` v prohlížeči (stačí dvojklik, žádný server není potřeba).
2. Stiskni mezerník — proběhne odpočet a hra začne.
3. Skákej přes bodce. Když narazíš, končíš. Druhý hráč pokračuje.
4. Rychlost se postupně zvyšuje. Skóre je uražená vzdálenost v metrech.

## Spuštění přes lokální server (volitelné)

```bash
python3 -m http.server 8000
# pak otevři http://localhost:8000
```

## Struktura

- `index.html` — struktura stránky a HUD
- `style.css` — vzhled, gradienty, animace překryvných obrazovek
- `game.js` — herní logika (fyzika, generování překážek, částicové efekty, vykreslování)

## Vlastnosti

- Zrcadlené rozdělení obrazovky se symetrickou gravitací
- Stejné překážky pro oba hráče → férový reflexní závod
- Plynule rostoucí obtížnost (rychlost)
- Částicové efekty: stopa za hráčem, obláček při skoku/dopadu, exploze při nárazu
- Rotující neonová kostka, zářící bodce, parallax mřížka v pozadí
- Funguje na klávesnici i dotykově (tablet / telefon)
