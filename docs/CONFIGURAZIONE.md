# Configurazione

Le variabili si leggono dal `.env` nella radice del progetto oppure, per
l'eseguibile, da `sestante.env` accanto a `Sestante.exe`. Le variabili
d'ambiente vere vincono sempre sul file. L'elenco completo, commentato, è in
[`.env.example`](../.env.example).

## Modalità e cartelle

```bash
SESTANTE_MODE=local     # oppure server
```

| | `local` (default) | `server` |
| --- | --- | --- |
| Ascolto (`HOST`) | `127.0.0.1` | `0.0.0.0` |
| `SESSION_SECRET` | se assente, generato al primo avvio e salvato in `DATA_DIR/.session-secret` | **obbligatorio**: senza, il server non parte |
| Uso tipico | postazione singola, eseguibile | installazione condivisa dietro proxy TLS |

Anche `NODE_ENV=production` rende obbligatorio `SESSION_SECRET`, in qualunque
modalità.

| Variabile | Default | Cosa contiene |
| --- | --- | --- |
| `DATA_DIR` | `./data` (eseguibile: `data\` accanto all'exe, o `%LOCALAPPDATA%\Sestante` se non scrivibile) | database, file caricati, segreti generati |
| `DATABASE_PATH` | `DATA_DIR/sestante.sqlite` | file SQLite; un valore esplicito è relativo alla radice |
| `UPLOADS_PATH` | `DATA_DIR/uploads` | file GeoJSON caricati dagli utenti |

Per un backup basta copiare `DATA_DIR`.

### Utente di default

```bash
DEFAULT_USER_EMAIL=admin@example.org   # default
DEFAULT_USER_NAME=Amministratore       # default
DEFAULT_USER_PASSWORD=                 # vedi sotto
# DEFAULT_USER=off                     # per non crearlo
```

Al primo avvio, se il database non ha nessun utente, il server crea questo
account locale. La password è quella di `DEFAULT_USER_PASSWORD`; se manca,
in modalità `local` vale `sestante2026` (il server ascolta solo su
127.0.0.1), in modalità `server` ne viene generata una casuale, scritta una
sola volta nel log di avvio. Una password configurata non finisce mai nel log.
Una password che non rispetta la regola (almeno 10 caratteri, lettere e
numeri) ferma l'avvio invece di creare un account debole.

### Percorso dell'app

```bash
PUBLIC_URL=https://mappe.example.org/sestante   # il percorso si legge da qui…
APP_BASE=/sestante/                              # …oppure si impone esplicitamente
```

Il server risponde sotto il percorso (toglie il prefisso all'ingresso, e accetta
anche le richieste senza, come il controllo di salute di un container), il
client lo riceve nella pagina come `<base href>`, e il cookie di sessione vale
solo per quel percorso. Gli indirizzi generati (link di condivisione, file,
redirect di Keycloak) partono da `PUBLIC_URL`, quindi lo comprendono.

GeoLibre fissa il proprio percorso nel build: va compilato per
`<APP_BASE>gis/` con `npm run build:geolibre` (o `npm run setup`), che legge
`APP_BASE` o `PUBLIC_URL` dall'ambiente o dal `.env`. All'avvio il server
confronta il build con il percorso dell'app: se non coincidono stampa
l'istruzione per ricompilare e ripiega sull'istanza pubblica di GeoLibre.

### PostgreSQL

```bash
DATABASE_URL=postgres://sestante:password@db.example.org:5432/sestante
DATABASE_POOL_MAX=10      # connessioni nel pool, default 10
DATABASE_CONNECT_TIMEOUT=60   # secondi di attesa del database all'avvio
```

All'avvio il server aspetta il database fino a `DATABASE_CONNECT_TIMEOUT`
secondi, riprovando ogni due: in Kubernetes i pod partono senza un ordine, e
PostgreSQL può arrivare dopo.

Con `DATABASE_URL` impostata il server usa PostgreSQL al posto di SQLite. Lo
schema si crea da solo al primo avvio (`CREATE TABLE IF NOT EXISTS`), quindi
basta un database vuoto e un utente che possa crearvi tabelle. Se il database
non è raggiungibile il server non parte, con il messaggio di `pg`. Per SSL si
usano i parametri dell'URL, ad esempio `?sslmode=require`.

I file caricati restano su disco, in `UPLOADS_PATH`, anche con PostgreSQL. Con
più istanze del server dietro un bilanciatore quella cartella va condivisa.

`npm run db:reset` funziona anche su PostgreSQL: svuota le tabelle invece di
cancellare un file, poi inserisce i dati di esempio.

Non c'è una migrazione automatica dei dati da un database SQLite esistente a
PostgreSQL: lo schema è lo stesso, quindi basta esportare e reimportare le sei
tabelle.

---

## Keycloak

Sul realm, crea un client OIDC:

| Impostazione            | Valore                                                |
| ----------------------- | ----------------------------------------------------- |
| Client ID               | `sestante`                                            |
| Client authentication   | **On** (client riservato: serve il secret)            |
| Standard flow           | abilitato                                             |
| Valid redirect URIs     | `http://localhost:4000/api/auth/keycloak/callback`    |
| Valid post logout URIs  | `http://localhost:5173/*`                             |
| Web origins             | `http://localhost:5173`                               |

Poi nel `.env`:

```bash
KEYCLOAK_ISSUER=https://sso.example.org/realms/sestante
KEYCLOAK_CLIENT_ID=sestante
KEYCLOAK_CLIENT_SECRET=...            # da Credentials nel client
KEYCLOAK_REDIRECT_URI=http://localhost:4000/api/auth/keycloak/callback
```

Il pulsante "Continua con SSO aziendale" compare solo quando **issuer e secret**
sono entrambi presenti. In produzione va cambiato anche `KEYCLOAK_REDIRECT_URI`
con il dominio reale, e deve combaciare esattamente con quello sul client.

Per l'eseguibile, che si apre su `http://localhost:4000`, redirect URI e origini
del client vanno impostati su quella porta. Conviene fissarla con `PORT=4000` in
`sestante.env`: con la porta occupata l'eseguibile ripiega sulla successiva e il
redirect non combacerebbe più.

Quando il server raggiunge Keycloak a un indirizzo diverso da quello del
browser (in Docker: `http://keycloak:8080`), si indica anche quello interno:

```bash
KEYCLOAK_ISSUER=https://mappe.example.org/auth/realms/sestante    # pubblico
KEYCLOAK_INTERNAL_ISSUER=http://keycloak:8080/auth/realms/sestante
```

Su Keycloak servono allora `KC_HOSTNAME` fisso sull'indirizzo pubblico e
`KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`: la configurazione letta dall'interno
dichiara così l'emittente e la pagina di accesso pubblici, e token e chiavi
interni. Se l'emittente dichiarato non coincide con `KEYCLOAK_ISSUER`, il
server lo segnala invece di rifiutare ogni accesso con un errore generico.

All'uscita Sestante chiude anche la sessione di Keycloak, passandogli
l'`id_token` ricevuto all'accesso (`id_token_hint`, conservato in un cookie
HttpOnly): così Keycloak non chiede conferma, e per rientrare serve di nuovo la
password.

Cosa verifica il server sull'`id_token`, nell'ordine: firma (RS256/RS384/RS512
o ES256, chiave presa dal JWKS tramite `kid`, con una sola rilettura forzata in
caso di rotazione), emittente, audience, scadenza, nonce. `alg: none` e gli
algoritmi HMAC sono rifiutati.

**Account già esistenti.** Se un'email ha già un account locale e poi arriva da
Keycloak, i due vengono **collegati**: stesso record, `provider` passa a
`keycloak` e da quel momento la vecchia password non accede più. È il caso reale
di chi ha usato l'accesso locale durante i test.

### Disattivare la registrazione locale

In produzione gli utenti arrivano da Keycloak:

```bash
ALLOW_LOCAL_SIGNUP=false
```

Gli account locali già creati continuano ad accedere; sparisce solo la
possibilità di crearne di nuovi dall'interfaccia.

---

## Relay di collaborazione

Il relay è `workers/collab-node` di GeoLibre, allo stesso commit del build:
`npm run build:geolibre` lo impacchetta in un unico file,
`geolibre-dist/relay/relay.cjs`, senza `node_modules`. Tre modi di avviarlo.

**Processo separato** (sviluppo, server):

```bash
npm run relay
```

Avvia `relay.cjs` con il segreto già allineato a quello del server, sulla porta
di `COLLAB_URL`, in ascolto su `127.0.0.1` (`COLLAB_HOST` per esporlo in rete).
Il database delle sessioni è `data/collab.sqlite`.

**Dentro il server** (eseguibile, o chi preferisce un processo solo):

```bash
COLLAB_EMBEDDED=1
COLLAB_URL=http://127.0.0.1:8787     # porta su cui il server apre il relay
```

Il server carica `relay.cjs` e lo avvia nel proprio processo. Se
`COLLAB_IDENTITY_SECRET` è vuoto, il segreto si genera da sé e si salva in
`DATA_DIR/.collab-secret`: server e relay sono lo stesso processo, quindi non
possono divergere. Se la porta è occupata Sestante parte comunque e la
collaborazione risulta non raggiungibile. Per un percorso diverso del file:
`COLLAB_RELAY_FILE`.

**Con Docker**, l'immagine ufficiale di GeoLibre:

```bash
docker run --rm -p 8787:8787 \
  -e COLLAB_IDENTITY_SECRET="<lo stesso valore del .env>" \
  -e ALLOWED_ORIGINS="http://localhost:5173" \
  ghcr.io/opengeos/geolibre-collab:latest
```

**La cosa da non sbagliare**, quando il relay è un processo a sé, è una sola:
`COLLAB_IDENTITY_SECRET` dev'essere identico da entrambe le parti. Se
differisce, ogni `identityToken` verifica a `null`, i partecipanti entrano
anonimi e non compare alcun errore. Per controllare:

```bash
curl http://localhost:8787/health
# {"ok":true,"service":"geolibre-collab","identitySupported":true}

curl http://localhost:4000/api/collab/status
# {"enabled":true,"reachable":true,"identitySupported":true}
```

`identitySupported: false` sul relay significa che il segreto non è arrivato al
processo.

### Collaborazione dentro la mappa

Con GeoLibre servito da Sestante su `/gis/` e il relay attivo, GeoLibre stesso
entra nella sessione: chi apre una mappa condivisa vede in tempo reale le
modifiche degli altri, i loro cursori e la chat di GeoLibre.
`/api/collab/status` lo dichiara con `"inMap": true`.

GeoLibre accetta solo `wss://`, oppure `ws://` su localhost. Dietro un proxy
il server raggiunge il relay in rete interna, il browser all'indirizzo
pubblico, quindi servono due variabili:

```bash
COLLAB_URL=http://relay:8787                    # dal server
COLLAB_PUBLIC_URL=wss://mappe.example.org/collab  # dal browser
```

`COLLAB_PUBLIC_URL` finisce anche nella CSP di `/gis/` (`connect-src`). In
locale non serve: `ws://127.0.0.1:8787` va bene così.

**Chi scrive.** Le sessioni nascono in sola lettura e con identità
obbligatoria:

| Ruolo in Sestante | Nella sessione |
| --- | --- |
| proprietario | host (con hostToken): modifica e modera |
| editor | ospite con invito `co-edit`: modifica |
| lettore | ospite in sola lettura: il relay rifiuta le sue modifiche |

Il proprietario può comunque allargare i permessi dal pannello di GeoLibre (è
l'host). Quando i permessi su una mappa si restringono (un editor diventa
lettore, una condivisione è revocata, cambia l'accesso generale) la sessione
viene sostituita: gli ospiti escono e rientrano da soli, con il ruolo nuovo,
appena il proprietario riapre la mappa.

La sessione la crea solo il proprietario. Chi apre la mappa prima di lui la vede
normalmente, e ogni 15 secondi controlla se la sessione è stata aperta.

---

## Istanza GeoLibre

**Default: servita da Sestante su `/gis/`.** Dopo `npm run build:geolibre` il
server serve il build in `geolibre-dist/web` (per l'eseguibile, la cartella
`geolibre\`) sulla propria origine, e `GEOLIBRE_URL` vale da sé `/gis/`. Le
opzioni fisse del build stanno in [`geolibre/build.env`](../geolibre/build.env),
il commit di GeoLibre in
[`geolibre/geolibre.lock.json`](../geolibre/geolibre.lock.json).

Ciò che dipende dall'installazione lo scrive il server in
`/gis/geolibre-runtime-config.js`, a ogni richiesta:

| Valore pubblicato | Da dove viene |
| --- | --- |
| origini autorizzate per l'API embed | `PUBLIC_URL` e l'origine da cui la pagina è arrivata |
| server di condivisione | sempre `off`: le mappe le gestisce Sestante |
| catalogo servizi | `GEOLIBRE_SERVICES_FILE` |
| servizi di esempio nascosti | `GEOLIBRE_BUILTIN_SERVICES=off` |

| Variabile | Default | Effetto |
| --- | --- | --- |
| `GEOLIBRE_URL` | `/gis/` se il build c'è, altrimenti `https://web.geolibre.app` | istanza da incorporare; un URL assoluto forza un'istanza esterna |
| `GEOLIBRE_DIST` | `./geolibre-dist/web` | cartella del build servito su `/gis/` |
| `GEOLIBRE_SERVICES_FILE` | — | catalogo WMS/WFS/WMTS/XYZ/ArcGIS/CSW proposto in GeoLibre |
| `GEOLIBRE_BUILTIN_SERVICES` | — | `off` nasconde i servizi di esempio (USGS, GEBCO…) |

Il catalogo ha lo stesso formato di `GEOLIBRE_SERVICES_FILE` dell'immagine
Docker di GeoLibre, e il server lo controlla allo stesso modo: un file
sbagliato ferma l'avvio con un messaggio, invece di produrre un catalogo vuoto.

```json
{
  "services": [
    {
      "id": "ortofoto-lazio",
      "name": "Ortofoto Regione Lazio",
      "kind": "wms",
      "category": "Basemap",
      "fields": { "url": "https://example.org/wms" }
    }
  ]
}
```

I campi di `fields` dipendono dal tipo di servizio: sono quelli del dialogo
corrispondente di GeoLibre.

**Senza build**, o con `GEOLIBRE_URL=https://web.geolibre.app`, si incorpora
l'istanza pubblica: la mappa si vede, ma l'API runtime ignora i comandi, i
GeoJSON si incorporano nel progetto con un tetto di 4 MB e Share punta a
`share.geolibre.app`.

---

## Produzione

```bash
npm run build:geolibre
npm run build
export SESTANTE_MODE=server
export PUBLIC_URL=https://mappe.example.org
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
npm start
```

In modalità `server` il processo si ferma se `SESSION_SECRET` manca o è rimasto
al valore di sviluppo. Il server serve client, API e GeoLibre dalla stessa
origine, quindi il cookie non è mai cross-site.

Il cookie di sessione è `Secure` quando `PUBLIC_URL` è in https: dipende da come
l'app è raggiunta, non da `NODE_ENV`. Dietro un reverse proxy assicurati che
inoltri `X-Forwarded-For`, `X-Forwarded-Proto` e `Host`: il server ne ricava
l'origine con cui autorizzare l'API embed di GeoLibre.

---

## Eseguibile

`npm run build:exe` produce `release/Sestante-<versione>-win32-x64.zip`.
L'eseguibile parte in modalità `local` e apre il browser. Le variabili utili in
`sestante.env` sono le stesse del `.env`, più:

| Variabile | Effetto |
| --- | --- |
| `SESTANTE_NO_BROWSER=1` | non apre il browser all'avvio |
| `PORT` | porta fissa; senza, se la 4000 è occupata prova le 9 successive |

Un esempio commentato è in `sestante.env.example`, dentro lo zip.
