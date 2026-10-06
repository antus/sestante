# 0001. GeoLibre senza fork, a una versione fissata, servito da Sestante

- Stato: accettata
- Data: 2026-10-06

## Contesto

Sestante usa GeoLibre come motore cartografico e lo vuole personalizzare il più
possibile. Un fork darebbe libertà totale ma andrebbe riallineato a ogni
release; servire GeoLibre da un CDN o da geolibre.app renderebbe Sestante
dipendente da un servizio esterno, anche per le installazioni senza Internet.

## Decisione

- GeoLibre si compila dal sorgente ufficiale a un **commit fissato** in
  [`build/geolibre/geolibre.lock.json`](../../build/geolibre/geolibre.lock.json);
  si cambia con `npm run geolibre:use`.
- Il build è **servito da Sestante** su `<base>gis/`, senza riferimenti a CDN
  (`GEOLIBRE_NO_EXTERNAL_CDN=1`): DuckDB, PGlite e GDAL entrano nel build.
- La personalizzazione passa solo dai punti previsti da GeoLibre: opzioni di
  build ([`build.env`](../../build/geolibre/build.env)), configurazione a runtime
  scritta dal server (`/gis/geolibre-runtime-config.js`), API embed v2, ponte
  `geolibre:*` e plugin ([`src/plugins/`](../../src/plugins)).
- Ciò che manca a GeoLibre si propone **upstream**.

## Conseguenze

- Aggiornare GeoLibre è cambiare un commit e ricompilare; il build verifica i
  punti d'appoggio da cui Sestante dipende e si ferma se sono cambiati.
- Il primo build è lento (qualche minuto, circa 2,4 GB di sorgente e
  dipendenze in `.out/cache/`); i successivi riusano la cache.
- Dove GeoLibre non offre un punto d'estensione serve un aggancio temporaneo
  (vedi [0002](0002-collaborazione.md)), da togliere quando la proposta
  upstream sarà accettata.
