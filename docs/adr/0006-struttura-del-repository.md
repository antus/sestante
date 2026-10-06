# 0006. Struttura del repository per ruolo

- Stato: accettata
- Data: 2026-10-06

## Contesto

Il repository era cresciuto per aggiunte: sorgenti, script, configurazioni di
distribuzione e prodotti generati stavano tutti al primo livello, e non era
chiaro a colpo d'occhio dove fossero il codice, i test, i documenti e le
distribuzioni.

## Decisione

Ogni cartella di primo livello ha **un solo ruolo**:

| Cartella | Ruolo |
| --- | --- |
| `src/` | codice sorgente: `server/`, `web/`, `plugins/` |
| `tests/` | test del sistema intero, avviato |
| `docs/` | documentazione: `guida/`, `sviluppo/`, `adr/`, `requisiti/` |
| `distribution/` | come si distribuisce, per destinazione |
| `build/` | strumenti di build e sviluppo, versione di GeoLibre |
| `.out/` | tutto ciò che si genera; ignorato da git, si può cancellare |

I test di **una sola applicazione** stanno accanto al suo codice
(`src/server/test/`); quelli del **sistema intero** in `tests/`.

## Conseguenze

- Cancellare `.out/` non perde nulla che non si possa ricostruire.
- Il Dockerfile sta in `distribution/docker/` ma il contesto di build resta la
  radice del repository (`-f distribution/docker/Dockerfile .`).
- Realm di Keycloak e init di PostgreSQL restano nel chart Helm, perché Helm
  non legge fuori dalla propria cartella; il compose li monta da lì.
