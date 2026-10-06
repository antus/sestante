# Sestante con Docker

Installazione server completa, in un comando: Sestante con PostgreSQL, Keycloak,
il relay di collaborazione e Caddy come unico ingresso HTTPS.

```bash
cd deploy
copy .env.example .env        # poi cambia TUTTI i segreti (cp su Linux/macOS)
docker compose up -d --build
```

La prima build richiede qualche minuto: dentro l'immagine si compila GeoLibre
alla versione di `geolibre/geolibre.lock.json`. Le build successive lo
riprendono dalla cache finché non cambiano versione, plugin o percorso.

Poi <https://localhost:8443>. Si entra con:

- l'**utente di default** di Sestante, `DEFAULT_USER_EMAIL` /
  `DEFAULT_USER_PASSWORD` del `.env` (con la password vuota ne viene
  generata una, scritta una sola volta in `docker compose logs sestante`);
- l'**utente di prova del realm**, `anna.verdi` / `DEMO_USER_PASSWORD`, con
  "Continua con SSO".

## Cosa parte

| Servizio | Immagine | Ruolo |
| --- | --- | --- |
| `caddy` | `caddy:2.10` | TLS e instradamento: `<base>auth` → Keycloak, `<base>collab` → relay, il resto → Sestante |
| `sestante` | costruita da `../Dockerfile` | API, client e GeoLibre su `<base>gis/`, in modalità `server` |
| `relay` | la stessa di Sestante | relay di collaborazione di GeoLibre (`node geolibre-dist/relay/relay.cjs`) |
| `keycloak` | `quay.io/keycloak/keycloak:26.4` | accesso SSO; il realm `sestante` si importa al primo avvio |
| `postgres` | `postgres:17` | un database e un utente ciascuno per Sestante e Keycloak |

Fra loro i servizi si parlano in rete interna (`http://keycloak:8080`,
`http://relay:8787`, `postgres:5432`); verso l'esterno è pubblicata solo Caddy.
Keycloak ha un indirizzo pubblico fisso (`KC_HOSTNAME`), così l'emittente dei
token è sempre quello che vede il browser, mentre Sestante legge la sua
configurazione dall'indirizzo interno (`KEYCLOAK_INTERNAL_ISSUER`).

## Configurazione (`deploy/.env`)

| Variabile | Default | Cosa decide |
| --- | --- | --- |
| `SESTANTE_HOST` | `localhost` | nome pubblico dell'host |
| `SESTANTE_HTTPS_PORT` / `SESTANTE_HTTP_PORT` | `8443` / `8080` | porte pubblicate da Caddy |
| `SESTANTE_APP_BASE` | `/` | percorso sotto cui sta tutto, ad esempio `/sestante/` (vedi sotto) |
| `CADDY_TLS` | `internal` | `internal` = CA locale di Caddy; un'email = certificato Let's Encrypt |
| `SESSION_SECRET`, `POSTGRES_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `COLLAB_IDENTITY_SECRET`, `KEYCLOAK_ADMIN_PASSWORD` | — | segreti, **obbligatori**: il compose si rifiuta di partire senza |
| `DEFAULT_USER_EMAIL`, `DEFAULT_USER_PASSWORD` | `admin@example.org`, — | utente di default di Sestante, creato al primo avvio |
| `DEMO_USER_PASSWORD` | `Sestante-demo-2026` | password dell'utente di prova del realm |
| `ALLOW_LOCAL_SIGNUP` | `false` | `true` per permettere anche la registrazione con email |
| `ORG_DOMAIN`, `ORG_LABEL` | `example.org` | dominio dell'accesso "tutta l'organizzazione" |

Un segreto si genera con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Pubblicare sotto un percorso

Con `SESTANTE_APP_BASE=/sestante/` tutto vive sotto quel percorso:
`https://host/sestante/` (app), `…/sestante/gis/` (GeoLibre),
`…/sestante/auth/` (Keycloak), `wss://host/sestante/collab/` (relay). Il resto
dell'host resta libero per altri servizi; la radice rimanda all'app.

GeoLibre fissa il proprio percorso nel build, quindi **cambiarlo richiede di
ricostruire l'immagine** (`docker compose up -d --build`). E Keycloak importa il
realm, con gli indirizzi dell'app, solo al primo avvio: su un'installazione già
avviata il cambio di percorso va riportato anche nel client `sestante` del
realm (Redirect URI, Web origins, Post logout redirect URI), dalla console di
amministrazione.

## Certificato

Con `CADDY_TLS=internal` il certificato è firmato dalla CA locale di Caddy: il
browser avvisa finché non la si considera attendibile. La si estrae con

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

e la si importa fra le autorità attendibili del sistema. Per un dominio
pubblico: `SESTANTE_HOST=mappe.example.org`, porte `443`/`80` e la propria email
in `CADDY_TLS`; Caddy ottiene e rinnova il certificato da sé.

## Dati e backup

Volumi: `postgres-data` (database di Sestante e Keycloak), `sestante-data`
(file caricati), `relay-data` (sessioni di collaborazione), `caddy-data`
(certificati). Per un backup coerente bastano i primi due:

```bash
docker compose exec -T postgres pg_dumpall -U postgres > backup.sql
docker compose cp sestante:/data ./sestante-data
```

`docker compose down` ferma tutto e conserva i dati; `docker compose down -v`
cancella anche i volumi.

## Verifica

Con lo stack avviato, dalla radice del progetto:

```bash
E2E_DEFAULT_PASSWORD=<DEFAULT_USER_PASSWORD> npm run test:e2e:stack
# sotto un percorso:
E2E_STACK_URL=https://localhost:8443/sestante/ npm run test:e2e:stack
```
