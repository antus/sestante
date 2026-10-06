# 0004. Quattro distribuzioni dallo stesso codice

- Stato: accettata
- Data: 2026-10-06

## Contesto

Sestante serve sia a una persona sul proprio PC sia a un'organizzazione su un
server, con le stesse funzioni. Ogni destinazione ha esigenze diverse:
nessuna installazione, un servizio sempre acceso, un'infrastruttura completa.

## Decisione

Quattro distribuzioni, in [`distribution/`](../../distribution), tutte dallo
stesso codice e dallo stesso build di GeoLibre:

- **eseguibile portabile**: `Sestante.exe` (Node single executable application,
  con il client come asset) e la cartella `geolibre/` accanto, in uno zip;
- **servizio Windows**: lo stesso eseguibile sotto WinSW;
- **Docker**: compose con Caddy (TLS), Keycloak, PostgreSQL e relay già
  configurati;
- **Kubernetes**: chart Helm con gli stessi componenti.

Tutte creano un **utente di default** al primo avvio e si possono pubblicare
sotto un percorso diverso da `/`.

## Conseguenze

- Il percorso di pubblicazione entra nel build di GeoLibre: cambiarlo richiede
  di ricompilarlo (il server avvisa se non coincide).
- L'eseguibile resta grande (circa 95 MB) perché contiene Node; GeoLibre sta
  fuori e si aggiorna sostituendo la cartella.
- Ogni distribuzione ha i suoi test end-to-end (`tests/e2e/stack`, `tests/e2e/dist`).
