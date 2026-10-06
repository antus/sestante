# 0007. Le modifiche al core di GeoLibre si fanno su un ramo e si propongono con una PR

- Stato: accettata
- Data: 2026-10-06
- Completa: [0001](0001-geolibre-senza-fork.md)

## Contesto

Alcuni requisiti di Sestante toccano il core di GeoLibre: lo store, il
pannello di stile, l'API dei plugin. Farli in un plugin vorrebbe dire duplicare
parti di GeoLibre o aggirarle; farli in un fork mantenuto è escluso dalla
decisione 0001. Aspettare che li implementino i maintainer, dopo una issue, può
richiedere molto tempo.

## Decisione

- Si implementano **in GeoLibre**, su un ramo di un fork usato **solo per
  le pull request**, e si propongono upstream a lavoro finito e verificato.
- Si provano dentro Sestante compilando il ramo con
  `npm run build:geolibre -- --src <checkout>`.
- Se servono ad altri prima del merge, il lock può puntare al commit sul fork
  (`npm run geolibre:use -- <ramo> --repo <fork>`); è temporaneo e segnalato.
- Per una modifica grande si apre prima una issue, o presto una PR in bozza,
  come chiede la guida di GeoLibre.

Procedura in [`docs/sviluppo/CONTRIBUIRE-A-GEOLIBRE.md`](../sviluppo/CONTRIBUIRE-A-GEOLIBRE.md).

## Conseguenze

- Il fork esiste ma Sestante non ne dipende stabilmente: accettata la PR, il
  lock torna al GeoLibre ufficiale.
- Una PR rifiutata lascia una scelta esplicita (plugin, adattamento o rinuncia),
  mai un fork che diverge in silenzio.
- Chi sviluppa ha bisogno anche dell'ambiente di GeoLibre (Node, e per il
  controllo completo Rust e Python).
