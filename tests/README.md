# Test

Due famiglie, in due posti:

- **accanto al codice** (`src/<applicazione>/test/`): provano una sola
  applicazione senza avviarla, in pochi secondi;
- **qui in `tests/`**: provano il sistema intero, avviato come lo userà
  chi lo installa.

| Tipo | Dove | Cosa prova | Comando |
| --- | --- | --- | --- |
| unitari del server | [`src/server/test/unit/`](../src/server/test/unit) | permessi, autenticazione, identityToken, livello dati, utente di default | `npm test` |
| integrazione delle API | [`src/server/test/integration/`](../src/server/test/integration) | le rotte HTTP con `app.inject()`: la matrice dei permessi completa (5 tipi d'accesso × 6 persone × 10 azioni) e i flussi principali | `npm test` |
| client | [`src/web/test/`](../src/web/test) | la logica del client con Vitest e jsdom: percorso dell'app, API, livelli GeoJSON, presenza, ponte con GeoLibre, traduzioni, tema, schermata d'accesso | `npm test` |
| end-to-end, locale | [`e2e/local/`](e2e/local) | i requisiti nell'uso da singolo utente: accesso, mappe, condivisione, collaborazione, GeoLibre, preferenze | `npm run test:e2e` |
| end-to-end, installazione server | [`e2e/stack/`](e2e/stack) | Keycloak, PostgreSQL, HTTPS, relay dietro proxy, percorso diverso da `/`, utente di default | `npm run test:e2e:stack` |
| end-to-end, distribuzioni | [`e2e/dist/`](e2e/dist) | l'eseguibile portabile e il servizio Windows | `npm run test:e2e:dist` |
| sicurezza | [`security/`](security) | casi d'abuso (sessioni falsificate, accesso a dati altrui, XSS, iniezioni, intestazioni) e scansione OWASP ZAP | `npm run test:security`, `npm run test:security:zap` |
| prestazioni | [`performance/`](performance) | scenari k6 con soglie su errori e tempi di risposta | `npm run test:performance` |

`npm test` esegue unitari e integrazione del server **due volte**, su SQLite e
su PostgreSQL (PGlite, in memoria), e poi i test del client: le stesse prove
garantiscono che schema e query sono portabili.

## End-to-end

Playwright, con Microsoft Edge su Windows e Chromium altrove. Le
configurazioni condividono [`e2e/shared.config.ts`](e2e/shared.config.ts);
report e risultati vanno in `.out/`.

- **local** avvia da sé un server con database temporaneo, relay nel processo
  e utenti di esempio ([`e2e/support/start-local.mjs`](e2e/support/start-local.mjs)).
  Serve il build di GeoLibre: `npm run setup`.
- **stack** prova un'installazione già avviata. Con Docker:

  ```bash
  cd distribution/docker && docker compose up -d --build && cd ../..
  E2E_STACK_URL=https://localhost:8443 npm run test:e2e:stack
  ```

  Con Kubernetes la stessa suite, più `E2E_K8S_NAMESPACE` perché i controlli
  sul database passino da `kubectl` (vedi [`distribution/kubernetes/README.md`](../distribution/kubernetes/README.md)).
- **dist** prova lo zip appena prodotto da `npm run build:exe`. L'installazione
  vera del servizio Windows chiede i diritti di amministratore e parte solo con
  `E2E_SERVICE=1`.

Ogni file e2e corrisponde a un requisito: la tabella "Test" del
[README](../README.md#test) dice quale.

## Porte

Ogni suite che avvia un server usa la sua porta, così si possono lanciare
insieme: e2e 4180, sicurezza 4181, ZAP 4183, prestazioni 4184.
