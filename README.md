# Sestante

Spazio di lavoro cartografico multi-utente costruito sul motore **GeoLibre**.
Gli utenti accedono (in locale o via Keycloak), creano mappe, le condividono in
lettura o in scrittura con colleghi, e le modificano insieme in tempo reale,
ognuno con il proprio ruolo. Lingua e tema sono dell'utente e vengono propagati
alla mappa.

Lo stesso codice gira in due modi: **sulla postazione di un singolo utente**,
anche come eseguibile da doppio clic, e **su un server** condiviso da più
utenti, con SQLite o PostgreSQL.

© 2026 Massimo Antonini — licenza [MIT](LICENSE).

---

## Avvio rapido (sviluppo)

Servono **Node 22.13 o superiore** (`node -v`) e **git**, con cui `npm run
setup` scarica GeoLibre. Nient'altro: niente Docker, niente PostgreSQL, nessuna
dipendenza nativa da compilare.

Se Node è una versione precedente:

```powershell
winget install OpenJS.NodeJS.LTS      # oppure l'installer LTS da nodejs.org
nvm install 22.13.0 && nvm use 22.13.0   # se usi nvm-windows
```

La soglia non è arbitraria: la persistenza usa `node:sqlite`, il modulo SQLite
integrato in Node (disponibile dalla 22.5), ed è ciò che evita di dover
compilare dipendenze native su Windows. Anche Vite 7 richiede almeno Node
20.19. `npm run setup` controlla la versione e si ferma con un messaggio
esplicito invece di fallire su un modulo mancante.

```bash
npm run setup     # dipendenze, database di esempio, build di GeoLibre e del relay
npm run dev       # avvia server (4000) e client (5173)
```

Poi apri <http://localhost:5173> e accedi con una delle utenze di esempio —
**la password è `sestante2026` per tutte**:

| Utente                       | Password       | Ruolo nei dati di esempio                     |
| ---------------------------- | -------------- | --------------------------------------------- |
| `m.antonini@example.org`     | `sestante2026` | proprietario di 3 mappe, invitato su altre 3  |
| `e.ricci@example.org`        | `sestante2026` | proprietaria di 2 mappe, editor su una         |
| `s.lombardi@example.org`     | `sestante2026` | solo lettura — utile per provare i permessi    |

`npm run setup` si può rilanciare quando si vuole: salta ciò che è già fatto,
**non ricrea un database esistente** (per quello c'è `npm run db:reset`) e
ricompila GeoLibre solo se manca o se è cambiata la versione in
`build/geolibre/geolibre.lock.json`. La prima volta scarica GeoLibre e ne installa le
dipendenze (qualche minuto, circa 2,4 GB in `.out/cache/`). Con
`npm run setup -- --skip-geolibre` si salta quel passo: Sestante incorpora
allora l'istanza pubblica `web.geolibre.app` e funziona lo stesso, con i limiti
descritti più sotto.

**Versione di GeoLibre.** Se non se ne indica un'altra, `setup` usa quella
fissata in [`build/geolibre/geolibre.lock.json`](build/geolibre/geolibre.lock.json): oggi il
commit `0692da3` di `main` del 18 settembre 2026, che si dichiara 3.0.0 ma è
successivo alla release v3.0.0. Per cambiarla:

```bash
npm run geolibre:use                # versione in uso e ultime release disponibili
npm run geolibre:use -- v3.3.0      # una release
npm run geolibre:use -- main        # la punta di main, fissata al commit di oggi
npm run setup                       # ricompila GeoLibre con la versione nuova
```

Nel lock finisce sempre l'hash del commit, così il build è ripetibile anche se
un tag o un ramo si spostano. Dopo un cambio di versione va ripetuto il collaudo
di [`docs/guida/COLLAUDO.md`](docs/guida/COLLAUDO.md).

Per la collaborazione serve il relay di GeoLibre. Il modo più semplice è farlo
ospitare dal server stesso, con una riga nel `.env`:

```bash
copy .env.example .env   # una volta sola
# nel .env:  COLLAB_EMBEDDED=1
```

In alternativa il relay gira come processo a sé, in un secondo terminale, con
`npm run relay` (è il modo da preferire su un server).

In sviluppo il client si aggiorna a caldo (Vite HMR) e il server si riavvia da
solo a ogni modifica (`tsx watch`); sessioni e dati sopravvivono al riavvio.

Per verificare che tutto funzioni davvero, la guida di collaudo passo per passo
è in [`docs/guida/COLLAUDO.md`](docs/guida/COLLAUDO.md).

---

## Versione locale: Sestante.exe

```bash
npm run setup            # se non già fatto: serve il build di GeoLibre
npm run build:exe        # → .out/release/Sestante-<versione>-win32-x64.zip
```

Lo zip (circa 120 MB) contiene:

```
Sestante/
├─ Sestante.exe          Node con dentro server e client React (~92 MB)
├─ geolibre/             il motore cartografico, servito su /gis/ (~266 MB)
├─ relay/relay.cjs       il relay di collaborazione di GeoLibre
├─ service/              servizio Windows: WinSW, configurazione, script
├─ sestante.env.example  configurazione facoltativa
└─ LEGGIMI.txt
```

Doppio clic sull'eseguibile: parte in modalità `local`, apre il browser su
<http://localhost:4000> (o sulla prima porta libera successiva) e tiene i dati
in `data\` accanto all'eseguibile — oppure in `%LOCALAPPDATA%\Sestante` se la
cartella non è scrivibile. Al primo avvio c'è già l'utente di default
`admin@example.org` / `sestante2026` (vedi più sotto); altri account si
registrano dalla pagina di accesso. Il segreto di sessione si genera da solo.

La configurazione facoltativa va in `sestante.env` accanto all'eseguibile
(stesse variabili del `.env`). Con `COLLAB_EMBEDDED=1` l'eseguibile ospita anche
il relay, senza altri programmi da avviare.

GeoLibre e il relay stanno fuori dall'eseguibile apposta: si aggiornano
sostituendo le cartelle, senza ricompilare Sestante.

Per ora lo zip si produce solo per Windows. L'eseguibile non è firmato: al
primo avvio Windows SmartScreen mostra un avviso.

### Come servizio Windows

Per averlo sempre attivo, senza finestra e con avvio automatico, da un
PowerShell **aperto come amministratore**, nella cartella `service\` dello zip:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-service.ps1            # porta 4000
powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -Port 8090
powershell -ExecutionPolicy Bypass -File .\uninstall-service.ps1          # -RemoveData per i dati
```

L'installazione copia Sestante in `C:\Program Files\Sestante`, mette dati e log
in `C:\ProgramData\Sestante`, registra il servizio `sestante` con l'account a
privilegi minimi *LocalService* e lo riavvia da sé se si ferma. Rilanciarla
aggiorna un'installazione esistente senza toccare dati e `sestante.env`.

Il servizio usa [WinSW](https://github.com/winsw/winsw) v2.12.0 (MIT):
`Sestante.exe` è un programma normale, e il gestore dei servizi di Windows ne
richiede uno che parli il suo protocollo. `npm run build:exe` lo scarica una
volta e ne verifica l'impronta SHA-256; WinSW non è firmato digitalmente.

---

## Installazione server con Docker

```bash
cd distribution/docker
copy .env.example .env        # e cambia i segreti
docker compose up -d --build
```

Avvia Sestante (modalità `server`, PostgreSQL), Keycloak con il realm già
configurato, il relay di collaborazione e Caddy come unico ingresso HTTPS su
<https://localhost:8443>. Dettagli, certificati, backup e pubblicazione su un
dominio vero in [`distribution/docker/README.md`](distribution/docker/README.md).

## Installazione su Kubernetes

Chart Helm in [`distribution/kubernetes/sestante`](distribution/kubernetes/sestante): Sestante,
PostgreSQL, Keycloak con il realm già configurato, il relay e gli Ingress per
nginx. I segreti si generano al primo `install` e restano negli aggiornamenti.

```bash
helm install sestante distribution/kubernetes/sestante -n sestante --create-namespace \
  --set host=mappe.example.org --set image.repository=registry.example.org/sestante
```

Immagine, valori, servizi esterni e prova in locale con kind in
[`distribution/kubernetes/README.md`](distribution/kubernetes/README.md).

## Utente di default

Ogni distribuzione nasce con un account con cui entrare, anche quando la
registrazione è chiusa. Il server lo crea al primo avvio, **solo se il database
non ha ancora utenti**: non lo ricrea se viene cancellato, e non reimposta una
password cambiata.

| Distribuzione | Email | Password |
| --- | --- | --- |
| sviluppo (`npm run setup`) | — | ci sono già gli utenti di esempio (`sestante2026`) |
| `Sestante.exe`, servizio Windows | `admin@example.org` | `sestante2026` |
| Docker | `DEFAULT_USER_EMAIL` di `distribution/docker/.env` | `DEFAULT_USER_PASSWORD` di `distribution/docker/.env`; vuota = generata e scritta una volta nel log |
| Kubernetes | `defaultUser.email` | `defaultUser.password`; vuota = generata e conservata nel Secret |

Si configura con `DEFAULT_USER_EMAIL`, `DEFAULT_USER_NAME`,
`DEFAULT_USER_PASSWORD`, oppure si spegne con `DEFAULT_USER=off`. In modalità
`server` una password non indicata viene sempre generata: un'installazione
condivisa non parte mai con una password che conoscono tutti. Le installazioni
con Keycloak hanno inoltre l'utente di prova del realm, `anna.verdi`.

## Pubblicare sotto un percorso

L'app può stare sotto un percorso diverso da `/`, ad esempio
`https://host/sestante/`. Il percorso si legge da `PUBLIC_URL`
(`https://host/sestante`) oppure da `APP_BASE`, e vale per tutto: il server
risponde sotto quel percorso, il client lo riceve nella pagina, il cookie di
sessione è limitato a esso.

GeoLibre invece fissa il proprio percorso (`<APP_BASE>gis/`) nel build, quindi
va compilato per quel percorso: `npm run setup` e `npm run build:geolibre`
leggono `APP_BASE` o `PUBLIC_URL` dal `.env`, e il server all'avvio controlla
che il build corrisponda. Se non corrisponde lo dice chiaramente e usa
l'istanza pubblica invece di servire una mappa che non si caricherebbe. Con
Docker basta `SESTANTE_APP_BASE` in `distribution/docker/.env`.

---

## Cosa fa, e chi lo fa

La divisione del lavoro è la parte importante di questo progetto.

**GeoLibre** porta tutto ciò che è cartografico: livelli, stile, elaborazione,
tabella attributi, i suoi oltre 6.500 elementi di interfaccia. Non è stato
riscritto nulla di tutto questo — viene incorporato.

**Sestante** porta ciò che GeoLibre non ha, e che in un contesto aziendale
dev'essere comunque vostro:

- **Identità.** GeoLibre non ha un flusso di accesso. Qui ci sono account
  locali (scrypt) e Keycloak OIDC, con Authorization Code + PKCE e verifica
  completa dell'id_token.
- **Mappe come oggetti con un proprietario**, non file da caricare.
- **Condivisione con ruoli**: invito per email, `viewer` / `editor`, accesso
  generale privato / organizzazione / link, link d'invito con ruolo incorporato.
- **Collaborazione con i ruoli di Sestante.** Chi apre una mappa condivisa entra
  da solo nella sessione del relay di GeoLibre e vede in tempo reale le
  modifiche degli altri. Sestante firma un `identityToken` che il relay
  verifica in HMAC-SHA256, quindi ognuno compare con la propria identità reale.
  Il proprietario entra come host, gli editor con un invito di scrittura, i
  lettori in sola lettura: un lettore non può modificare la sessione nemmeno
  manomettendo il proprio browser, perché è il relay a rifiutarlo. Quando i
  permessi si restringono, la sessione viene sostituita.
- **Persistenza del progetto.** Livelli, stili, basemap e camera vengono
  salvati e ripristinati attraverso il ponte di stato `geolibre:*` — lo stesso
  che alimenta il widget Python di GeoLibre — su SQLite oppure PostgreSQL. Vedi
  [`docs/sviluppo/ARCHITETTURA.md`](docs/sviluppo/ARCHITETTURA.md).

---

## Struttura

Ogni cartella di primo livello ha un solo ruolo.

```
sestante/
├─ src/                      CODICE SORGENTE (workspace npm)
│  ├─ server/                API Fastify + SQLite (node:sqlite) o PostgreSQL (pg)
│  │  ├─ src/auth/           password scrypt, sessioni firmate, OIDC Keycloak
│  │  ├─ src/routes/         auth, mappe, condivisione, file, collaborazione, GeoLibre su /gis/
│  │  ├─ src/acl.ts          i permessi, in un unico posto
│  │  ├─ src/db.ts           SQLite e PostgreSQL dietro la stessa interfaccia
│  │  ├─ src/relay-host.ts   il server come host di una sessione (inviti, sostituzione)
│  │  ├─ src/geolibre-bridge.ts  l'aggancio della collaborazione dentro GeoLibre
│  │  ├─ src/paths.ts        percorsi in sviluppo e nell'eseguibile
│  │  └─ test/unit/          identityToken, ACL, autenticazione, livello dati
│  ├─ web/                   client React + Vite
│  │  ├─ src/lib/            api, i18n IT/EN, tema, presenza e ponte con GeoLibre
│  │  ├─ src/components/
│  │  └─ src/screens/        Login, Dashboard, Editor
│  └─ plugins/               plugin GeoLibre di Sestante, uno per cartella
├─ tests/                    TEST DI SISTEMA, sull'applicazione avviata (mappa in tests/README.md)
│  └─ e2e/                   end-to-end per requisito: local, stack, dist
├─ docs/                     DOCUMENTAZIONE
│  ├─ guida/                 configurazione, collaudo
│  ├─ sviluppo/              architettura, proposta di PR a GeoLibre
│  ├─ adr/                   decisioni architetturali
│  └─ requisiti/             dove stanno i requisiti (GitHub Issues e Project)
├─ distribution/             COME SI DISTRIBUISCE, per destinazione (vedi distribution/README.md)
│  ├─ portable/              Sestante.exe + zip portabile
│  ├─ windows-service/       servizio Windows con WinSW
│  ├─ docker/                Dockerfile, compose con Caddy, Keycloak, PostgreSQL e relay
│  └─ kubernetes/            chart Helm, cluster kind di prova
├─ build/                    STRUMENTI DI BUILD E SVILUPPO
│  ├─ geolibre/              versione fissata (geolibre.lock.json) e opzioni di build
│  └─ scripts/               setup, sviluppo, relay, versione e build di GeoLibre, requisiti
└─ .out/                     GENERATO, ignorato da git: si può cancellare e si ricostruisce
   ├─ cache/                 sorgente di GeoLibre, WinSW, strumenti
   ├─ geolibre/              build di GeoLibre e relay
   ├─ release/               eseguibile e zip
   ├─ data/                  database e file dello sviluppo
   └─ e2e/                   report e risultati dei test end-to-end
```

---

## Configurazione

Copia `.env.example` in `.env` (per l'eseguibile: `sestante.env` accanto a
`Sestante.exe`). Nessuna variabile è obbligatoria al primo avvio in modalità
`local`: senza Keycloak resta l'accesso locale, senza relay la collaborazione è
spenta, e l'applicazione dichiara da sola cosa è attivo.

| Variabile                | Perché                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| `SESTANTE_MODE`          | `local` (default) o `server`. Vedi sotto                             |
| `SESSION_SECRET`         | firma i cookie di sessione. **Obbligatoria in modalità `server`**; in `local` si genera da sola |
| `KEYCLOAK_ISSUER`        | attiva l'SSO. Vuota = solo accesso locale                            |
| `PUBLIC_URL`             | indirizzo pubblico dell'app, percorso compreso (`https://host/sestante`) |
| `APP_BASE`               | percorso dell'app, se non lo si dà in `PUBLIC_URL`                    |
| `DATABASE_URL`           | `postgres://…` per usare PostgreSQL. Vuota = SQLite                  |
| `DATA_DIR`               | cartella di database, file caricati e segreti generati              |
| `DEFAULT_USER_EMAIL`, `DEFAULT_USER_PASSWORD` | utente di default creato al primo avvio (`DEFAULT_USER=off` per non crearlo) |
| `COLLAB_EMBEDDED`        | `1` = relay nel processo del server, con segreto generato da sé      |
| `COLLAB_URL`             | relay di collaborazione. Vuota (e senza `COLLAB_EMBEDDED`) = spenta |
| `COLLAB_PUBLIC_URL`      | relay visto dal browser, se diverso (dietro un proxy: `wss://…`)    |
| `COLLAB_IDENTITY_SECRET` | con il relay a sé: **stesso valore** qui e sul relay, altrimenti tutti entrano anonimi |
| `GEOLIBRE_URL`           | vuota = `/gis/` se il build c'è; un URL assoluto forza un'istanza esterna |
| `GEOLIBRE_SERVICES_FILE` | catalogo di servizi WMS/WMTS/WFS/XYZ proposti in GeoLibre           |

| | `local` | `server` |
| --- | --- | --- |
| Ascolto | `127.0.0.1` | `0.0.0.0`, dietro un proxy TLS |
| Segreto di sessione | generato al primo avvio in `DATA_DIR` | va configurato, altrimenti non parte |
| Cookie `Secure` | solo se `PUBLIC_URL` è https | solo se `PUBLIC_URL` è https |

Dettagli in [`docs/guida/CONFIGURAZIONE.md`](docs/guida/CONFIGURAZIONE.md).

---

## Comandi

| Comando                  | Cosa fa                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `npm run setup`          | dipendenze, database di esempio (se manca), build di GeoLibre (se serve) |
| `npm run dev`            | server + client in sviluppo, con ricaricamento automatico         |
| `npm run geolibre:use`   | mostra o cambia la versione di GeoLibre (release, ramo o commit)  |
| `npm run build:geolibre` | build di GeoLibre a versione fissata, plugin e relay inclusi      |
| `npm run relay`          | avvia il relay di GeoLibre da `.out/geolibre/relay/relay.cjs`     |
| `npm test`               | test di identityToken, permessi, autenticazione e livello dati, su SQLite e su PostgreSQL (PGlite) |
| `npm run build`          | compila server e client per la produzione                         |
| `npm start`              | avvia la build (il server serve client e GeoLibre)                |
| `npm run build:exe`      | `Sestante.exe` + `geolibre/` + `relay/` in uno zip portabile      |
| `npm run db:reset`       | ricrea il database da zero, con i dati di esempio                 |
| `npm run test:e2e`       | test end-to-end in modalità locale (avvia da sé il server)        |
| `npm run test:e2e:stack` | test end-to-end contro un'installazione server avviata (compose o Kubernetes) |
| `npm run test:e2e:dist`  | test end-to-end dell'eseguibile e del servizio Windows            |

---

## Test

| Livello | Comando | Cosa prova |
| --- | --- | --- |
| unitari | `npm test` | identità firmata, permessi, autenticazione, livello dati — su SQLite **e** su PostgreSQL (PGlite) |
| e2e locale | `npm run test:e2e` | il server in modalità `local` con dati temporanei, SQLite e relay incorporato, in un browser vero |
| e2e server | `npm run test:e2e:stack` | un'installazione server completa — compose o Kubernetes: Keycloak, PostgreSQL, HTTPS e `wss` attraverso il proxy |
| e2e distribuzione | `npm run test:e2e:dist` | lo zip appena costruito: eseguibile e servizio Windows |

I test e2e sono ordinati per requisito, un file ciascuno:

| Requisito | Dove |
| --- | --- |
| accesso locale (registrazione, credenziali errate, uscita) | `tests/e2e/local/auth.spec.ts` |
| accesso con Keycloak, uscita che chiude anche l'SSO | `tests/e2e/stack/sso.spec.ts` |
| creare mappe, caricare dati, ritrovarli riaprendo | `tests/e2e/local/maps.spec.ts` |
| condividere con ruoli, accesso generale, inviti; permessi fatti rispettare dal server | `tests/e2e/local/sharing.spec.ts` |
| modificare insieme in tempo reale, con ruoli e identità | `tests/e2e/local/collaboration.spec.ts` |
| GeoLibre senza fork e senza CDN, configurato dal server | `tests/e2e/local/geolibre.spec.ts` |
| lingua e tema propagati alla mappa | `tests/e2e/local/preferences.spec.ts` |
| installazione server: PostgreSQL, HTTPS, relay via proxy | `tests/e2e/stack/server.spec.ts` |
| pubblicazione sotto un percorso | `tests/e2e/stack/base-path.spec.ts` |
| utente di default nelle installazioni server | `tests/e2e/stack/default-user.spec.ts` |
| eseguibile per un singolo utente, con il suo utente di default | `tests/e2e/dist/exe.spec.ts` |
| servizio Windows | `tests/e2e/dist/windows-service.spec.ts` |

Su Windows i test usano Edge, già installato; altrove il Chromium di
Playwright (`npx playwright install chromium`). L'installazione reale del
servizio si prova solo da un terminale amministratore con `E2E_SERVICE=1`.

---

## Limiti noti, dichiarati

**Tema e lingua rimontano la mappa.** GeoLibre riceve `theme` e `lang` come
parametri di URL e non espone alcun comando per cambiarli a caldo, quindi
l'iframe viene ricreato. La perdita però è contenuta: l'ultimo progetto
ricevuto viene ricaricato appena la nuova istanza è pronta, così livelli, stili
e basemap sopravvivono. Si perdono selezione, misure in corso e strumenti
aperti.

**La collaborazione nella mappa passa da un aggancio.** GeoLibre non offre
ancora un modo supportato per entrare in una sessione da fuori con identità e
ruolo: lo fa uno script che Sestante serve nella configurazione di GeoLibre
(`src/server/src/geolibre-bridge.ts`), senza toccarne il codice. I punti di GeoLibre
su cui si appoggia sono verificati a ogni `build:geolibre`. La proposta per
renderlo superfluo è in [`docs/sviluppo/PR-GEOLIBRE-COLLAB.md`](docs/sviluppo/PR-GEOLIBRE-COLLAB.md).

**Un ruolo ridotto si vede alla ricarica.** Se un editor diventa lettore mentre
ha la mappa aperta, esce subito dalla sessione e vi rientra in sola lettura, ma
la sua pagina continua a credersi editor finché non la ricarica: i suoi
tentativi di salvare vengono rifiutati dal server.

**La mappa di base richiede internet.** Le tessere della mappa di base
predefinita di GeoLibre arrivano da OpenFreeMap: è l'unico contatto verso
l'esterno rimasto, e senza connessione la mappa si apre senza sfondo. I font di
Sestante viaggiano con il client.

**Lingua e tema sono del browser, non dell'account.** Si conservano nel
browser in cui si scelgono: su un altro computer si ritrovano i valori
predefiniti. Il database ha già le colonne per tenerli con l'utente, ma non
vengono ancora usate.

**Senza `build:geolibre` si ricade sull'istanza pubblica.** Con
`web.geolibre.app` la mappa si vede, ma l'API runtime ignora i comandi (non ha
un'allowlist che includa Sestante), i GeoJSON si incorporano nel progetto con un
tetto di 4 MB, la collaborazione resta fuori dalla mappa, e Share e Galleria
puntano a `share.geolibre.app`.

---

## Licenze

Sestante è distribuito con licenza **MIT** — © 2026 Massimo Antonini, vedi
[`LICENSE`](LICENSE). GeoLibre, `@geolibre/embed`, `@geolibre/collab-core`
e il relay sono anch'essi MIT (Copyright Qiusheng Wu), come WinSW per il
servizio Windows. I font
IBM Plex sono sotto SIL Open Font License. I contorni cartografici delle
anteprime vengono da Natural Earth, pubblico dominio.
