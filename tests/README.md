# Test

Due famiglie, in due posti:

- **accanto al codice** (`src/<applicazione>/test/`): provano una sola
  applicazione senza avviarla, in pochi secondi;
- **qui in `tests/`**: provano il sistema intero, avviato come lo userà
  chi lo installa.

| Tipo | Dove | Cosa prova | Comando |
| --- | --- | --- | --- |
| unitari del server | [`src/server/test/unit/`](../src/server/test/unit) | permessi, autenticazione, identityToken, livello dati, utente di default | `npm test` |
| end-to-end, locale | [`e2e/local/`](e2e/local) | i requisiti nell'uso da singolo utente: accesso, mappe, condivisione, collaborazione, GeoLibre, preferenze | `npm run test:e2e` |
| end-to-end, installazione server | [`e2e/stack/`](e2e/stack) | Keycloak, PostgreSQL, HTTPS, relay dietro proxy, percorso diverso da `/`, utente di default | `npm run test:e2e:stack` |
| end-to-end, distribuzioni | [`e2e/dist/`](e2e/dist) | l'eseguibile portabile e il servizio Windows | `npm run test:e2e:dist` |

`npm test` gira due volte, su SQLite e su PostgreSQL (PGlite, in memoria):
le stesse prove garantiscono che lo schema e le query sono portabili.

## End-to-end

Playwright, con Microsoft Edge su Windows e Chromium altrove. Le tre
configurazioni condividono [`e2e/shared.config.ts`](e2e/shared.config.ts);
report e risultati vanno in `.out/e2e/`.

- **local** avvia da sé un server con database temporaneo, relay nel processo
  e utenti di esempio ([`e2e/support/start-local.mjs`](e2e/support/start-local.mjs)).
  Serve il build di GeoLibre: `npm run setup`.
- **stack** prova un'installazione già avviata. Con Docker:

  ```bash
  cd distribution/docker && docker compose up -d --build
  E2E_STACK_URL=https://localhost:8443 npm run test:e2e:stack
  ```

  Con Kubernetes la stessa suite, più `E2E_K8S_NAMESPACE` perché i controlli
  sul database passino da `kubectl` (vedi [`distribution/kubernetes/README.md`](../distribution/kubernetes/README.md)).
- **dist** prova lo zip appena prodotto da `npm run build:exe`. L'installazione
  vera del servizio Windows chiede i diritti di amministratore e parte solo con
  `E2E_SERVICE=1`.

Ogni file di test corrisponde a un requisito: la tabella "Test" del
[README](../README.md#test) dice quale.

## Previsti

| Tipo | Dove | Cosa proverà |
| --- | --- | --- |
| client | `src/web/test/` | la logica del client con Vitest: percorsi, presenza, ponte con GeoLibre |
| integrazione delle API | `src/server/test/integration/` | le rotte con `app.inject()`, la matrice dei permessi completa |
| sicurezza | `tests/security/` | casi d'abuso (accesso a mappe altrui, inviti scaduti, sessioni manomesse) e scansione OWASP ZAP |
| prestazioni | `tests/performance/` | scenari k6, quando serviranno |
