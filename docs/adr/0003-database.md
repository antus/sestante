# 0003. SQLite in locale, PostgreSQL condiviso, dietro la stessa interfaccia

- Stato: accettata
- Data: 2026-10-06

## Contesto

Sestante deve partire senza installare nulla per una persona sola, e reggere
più utenti e più repliche in un'installazione condivisa.

## Decisione

- In locale **SQLite** (`node:sqlite`, incluso in Node): un file in
  `DATA_DIR`, nessun servizio da avviare.
- In un'installazione condivisa **PostgreSQL**, scelto con `DATABASE_URL`.
- Un'unica interfaccia asincrona (`get`, `all`, `run`, `exec`) in
  [`db.ts`](../../src/server/src/db.ts); le query sono SQL portabile, con i
  segnaposto `?` tradotti in `$n` per PostgreSQL.
- I test unitari girano **su entrambi i motori**; PostgreSQL in memoria con
  PGlite, senza server.

## Conseguenze

- Niente funzioni specifiche di un motore nello schema e nelle query.
- Passare da SQLite a PostgreSQL non richiede codice, solo una migrazione dei
  dati (oggi non automatica).
