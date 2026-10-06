# Test di prestazioni

Scenari [k6](https://k6.io): utenti virtuali che usano le API come le usano la
dashboard e l'editor, con soglie che fanno fallire la prova se superate.

```bash
npm run test:performance             # profilo "carico": fino a 20 utenti per 2 minuti
npm run test:performance -- fumo     # 1 utente per 15 secondi, per provare lo scenario
PERF_TARGET=https://host/sestante npm run test:performance    # un'installazione esistente
```

Usa `k6` se è installato, altrimenti l'immagine Docker `grafana/k6`. Senza
`PERF_TARGET` avvia da sé un server locale (SQLite, dati di esempio) sulla
porta 4184. Il riepilogo in JSON va in `.out/performance/`.

## Scenari

| Scenario | Cosa fa | Soglie |
| --- | --- | --- |
| [`uso-normale`](scenari/uso-normale.js) | due utenti sulla stessa mappa condivisa: elenco delle mappe, apertura, elenco dei file, salvataggio del progetto, una volta al secondo per utente virtuale | errori < 1%, 95° percentile < 500 ms |

Un nuovo scenario è un file in `scenari/`; si sceglie con `PERF_SCENARIO=<nome>`.

## Che cosa non misurano

- **GeoLibre e i file statici**: li serve il server con una cache lunga, e il
  loro costo è nel browser, non sul server.
- **La collaborazione in tempo reale**: passa dal relay di GeoLibre su
  WebSocket; uno scenario dedicato servirà quando le sessioni contemporanee
  diventeranno un requisito con un numero.
- **PostgreSQL**: con `PERF_TARGET` puntato a un'installazione Docker o
  Kubernetes si misura quello; il server locale usa SQLite.

## Riferimento

Su un PC di sviluppo (server locale, SQLite) il profilo "carico" ha dato:
6.457 richieste in 1 minuto e 45 secondi, nessun errore, 95° percentile 17 ms.
