# Architettura

Il documento spiega **perché** le cose stanno dove stanno. Le scelte discutibili
sono segnate come tali, con l'alternativa e il suo costo.

---

## Il quadro d'insieme

```
    ┌──────────────────────────────────────────────────────────┐
    │  Browser                                                  │
    │  ┌────────────────────────────────────────────────────┐  │
    │  │  Sestante (React)                                   │  │
    │  │  barra: identità · condivisione · utenti connessi   │  │
    │  ├────────────────────────────────────────────────────┤  │
    │  │  <iframe> GeoLibre                                  │  │
    │  │  livelli · stile · elaborazione · attributi         │  │
    │  └────────────────────────────────────────────────────┘  │
    └───────┬──────────────────────┬───────────────────────────┘
            │ cookie di sessione   │ WebSocket + identityToken
            ▼                      ▼
    ┌───────────────┐      ┌──────────────────────────┐
    │ Sestante API  │─────▶│ Relay GeoLibre (Node)     │
    │ Fastify       │ HTTP │ sessioni · presenza       │
    │ SQLite        │      │ permessi per partecipante │
    └───────┬───────┘      └──────────────────────────┘
            │ OIDC
            ▼
    ┌───────────────┐
    │   Keycloak    │  (opzionale)
    └───────────────┘
```

Tre processi, tre responsabilità separate. Il relay è **di GeoLibre**, non
nostro: lo si avvia e lo si configura, non lo si mantiene.

---

## Perché l'iframe, e perché non è la destinazione finale

L'alternativa era costruire la shell su `@geolibre/core` e `@geolibre/map`, i
due pacchetti npm pubblicati (MIT). Danno il motore: tipi di dominio, schema di
progetto, store Zustand, sincronizzazione dei livelli e stile MapLibre.

Non danno l'interfaccia. `@geolibre/ui` è `private: true` e non è pubblicato, e
comunque è solo un kit di primitive shadcn/Radix. Ciò che conta — pannello
livelli, pannello stile, le maschere dei 1.000 strumenti Whitebox, la tabella
attributi, il Model Builder — vive in `apps/geolibre-desktop/src/components` e
non è pacchettizzato affatto. La misura: il catalogo i18n dell'app contiene
**6.533 stringhe di interfaccia in 110 sezioni**, e i due soli file di layout
principali sono 2.610 e 3.174 righe. Ricostruirlo non è un progetto, è una
riscrittura.

Quindi: iframe adesso, per avere qualcosa che funziona; fork della shell poi,
per togliere il limite su tema e lingua. Il codice è scritto perché il secondo
passo tocchi un solo componente — `src/web/src/components/MapFrame.tsx` — e nulla
del resto.

---

## Due ponti postMessage, non uno

È la cosa che va capita per non concludere (sbagliando) che il contenuto di una
mappa non sia recuperabile dall'esterno. GeoLibre ne espone **due**, distinti:

| | API embed v2 | Ponte di stato `geolibre:*` |
|---|---|---|
| Pacchetto | `@geolibre/embed` | nessuno: messaggi diretti |
| Messaggi | `{v:2, type, payload}` | `{type:"geolibre:…"}` |
| A cosa serve | comandare la mappa | trasportare il **progetto** |
| Attivazione | `GEOLIBRE_EMBED_ORIGINS` | `?embed=1` sull'URL |
| Legge il progetto | **no** | **sì** |

Il primo comanda: `setView`, `setLayerVisibility`, `addData`, `exportImage`,
`setRenderer`… e non ha alcun comando per leggere il progetto — l'elenco dei
`case` in `useEmbedApi.ts` lo conferma. È da qui che nasce l'impressione che la
configurazione non si possa recuperare.

Il secondo (`useEmbedBridge.ts`) è quello che alimenta il widget Python, e fa
esattamente ciò che serve:

- pubblica **`geolibre:state`** con lo snapshot completo del progetto — livelli,
  gruppi, stili, basemap e camera — a ogni cambiamento dello store, con 250 ms
  di debounce;
- risponde a **`geolibre:request-state`** con uno snapshot immediato;
- applica **`geolibre:load-project`**, il percorso inverso;
- annuncia **`geolibre:ready`** al montaggio.

Lo snapshot è prodotto da `buildProjectSnapshot`, definizione unica condivisa
con la collaborazione: ciò che arriva a noi è byte per byte quello che GeoLibre
trasmette ai propri peer. Ed è **redatto**: le credenziali dei servizi non
escono verso la pagina che incorpora.

### Come Sestante lo usa: tre fasi, non un semplice "carica all'avvio"

Il ciclo ingenuo — aspetta `ready`, manda `load-project` — **non funziona**, e
il modo in cui fallisce è insidioso: il progetto viene applicato e poi
sovrascritto dall'avvio dell'app, che monta il proprio subito dopo. A schermo il
livello compare un istante nella legenda e sparisce; e se quello stato vuoto lo
si salva, il lavoro dell'utente è perso senza preavviso.

`MapFrame` attraversa quindi tre fasi:

| Fase | Cosa invia | Cosa persiste |
|---|---|---|
| `probing` | solo `request-state` (innocuo) | **niente** |
| `restoring` | `load-project` + richiesta di conferma | **niente** |
| `live` | nulla | ogni snapshot |

La prima risposta dell'app certifica che l'avvio è concluso: solo allora si
spinge il progetto. La conferma non si fa sul JSON — GeoLibre **normalizza** ciò
che carica, quindi lo snapshot di ritorno non è mai identico — ma sugli **id dei
livelli**, che alla normalizzazione sopravvivono.

Anche la conferma però non basta: la sovrascrittura può arrivare un secondo
*dopo*. Per cinque secondi dal ripristino vale una **finestra di sorveglianza**:
uno snapshot che perde i livelli appena ripristinati viene letto come
sovrascrittura, non salvato, e il progetto viene ricaricato (fino a cinque
tentativi). Il compromesso è dichiarato: se entro quei cinque secondi l'utente
cancellasse davvero tutti i livelli, se li vedrebbe tornare una volta. Sbagliare
in quella direzione costa un livello da ricancellare; sbagliare nell'altra costa
il progetto.

Due controlli sui messaggi in ingresso, non uno: l'origine attesa **e** che il
messaggio venga proprio dal nostro iframe. Senza il secondo, un'altra finestra
della stessa origine potrebbe iniettare uno stato.

### I file GeoJSON, e perché il ponte da solo non bastava

Un livello WMS si ricaricava, uno aperto da file no. La differenza non è
casuale, ed è scritta nel codice di GeoLibre: quando prepara il progetto per la
pagina che lo incorpora, scarta la geometria dei livelli che ha caricato da un
file locale.

```js
if (e.geojson && e.metadata.localFileReloadable === true) { togli geojson }
if (e.metadata.externalNativeLayer === true && e.geojson && (haUrl(e) || ...)) { togli geojson }
```

Per GeoLibre è corretto: il file sta sul disco dell'utente e lo ricaricherà da
lì. Per noi significa ricevere un livello vuoto — e per chi riceve la
condivisione, un livello che non potrà mai avere. Il WMS invece porta un URL
raggiungibile, e infatti sopravviveva.

La cura è togliere il file dal disco dell'utente: **si carica da Sestante**, non
dal selettore di GeoLibre. Il file diventa una risorsa della mappa
(`src/server/src/storage.ts`, `src/server/src/routes/files.ts`), con la vita e i
permessi della mappa; e il livello che costruiamo (`src/web/src/lib/geodata.ts`) non
porta nessuno dei due contrassegni qui sopra, quindi GeoLibre non ha ragione di
scartarne i dati e lo restituisce intero a ogni snapshot.

**Il campo che decide se il livello si vede.** `type` deve valere esattamente
`"geojson"`. Non è il tipo geometrico — quello GeoLibre lo deduce dai dati — ma
il discriminante con cui decide se il livello è materializzabile. Un livello con
`type: "circle"` o `"fill"` viene accettato, compare nella legenda, torna
indietro negli snapshot con tutti i suoi elementi, e **non viene mai disegnato**:
nessun errore, nessun avviso, una mappa vuota. Lo dice il suo costruttore,

```js
addGeoJsonLayer: (nome, geojson, …) => ({ id, name: nome, type: "geojson",
  source: { type: "geojson" }, visible: true, opacity: 1, style: …,
  metadata: {}, geojson })
```

e lo conferma la funzione che calcola le capacità del livello, dove `create` e
`update` valgono `e.type === "geojson" && …`. È un errore che abbiamo fatto e
che è costato una diagnosi, perché tutti i segnali osservabili dall'esterno —
progetto salvato, legenda, snapshot di ritorno — dicevano che funzionava.

**Due autorizzazioni sulla lettura**, perché la richiesta al file non parte da
Sestante ma dall'iframe, che è un'altra origine e non porta il nostro cookie:
sessione valida più ACL, **oppure** un segreto per file incorporato nell'URL.
Il secondo è una capacità — chi ha l'URL completo legge, anche se la
condivisione gli viene tolta dopo — ed è la stessa semantica del «chiunque abbia
il link» che Sestante già offre sulle mappe. Si revoca cancellando il file.

**Il vincolo che decide come viaggiano i dati.** Una pagina servita in https non
può caricare una risorsa in http: il browser blocca la richiesta *prima* di
inviarla. Misurato, non dedotto — dalla pagina GeoLibre, perfino una fetch in
`mode:"no-cors"`, dove un errore CORS è impossibile per costruzione, fallisce
verso `http://localhost:4000`, che dallo stesso browser risponde 200.

Quindi con l'istanza pubblica in https e Sestante in http il riferimento per URL
produrrebbe un livello che non si carica mai, e `pickMode` ripiega sulla
geometria incorporata nel progetto: nessuna richiesta di rete, nessun problema —
al prezzo di un progetto che pesa quanto il file, e di un tetto a 4 MB.
Servendo GeoLibre sullo stesso schema si passa da soli al riferimento per URL.

È la terza cosa che chiede la stessa soluzione, dopo l'API comandi e il marchio:
**un'istanza GeoLibre vostra**. Non tre lavori, uno.

### Dove finiscono i file, e come si esce

`data/uploads/<id-mappa>/<id-file>`, accanto al database: coerente con SQLite,
zero configurazione. La superficie in `storage.ts` è deliberatamente minima —
mettere, leggere, cancellare — e nessuna nozione di percorso esce di lì, perché
un percorso è esattamente ciò che S3 non ha. Il passaggio a MinIO o Apache Ozone
tocca quel file e nient'altro.

### Cosa resta del problema tema/lingua

Restano parametri di URL, quindi cambiarli rimonta l'iframe. Ma ora l'ultimo
snapshot viene ricaricato appena la nuova istanza è pronta: livelli e stili
sopravvivono. Si perdono selezione, misure in corso e strumenti aperti — molto
meno di prima, e non più un ostacolo all'uso quotidiano.

---

## Identità e presenza: come si tengono

È la catena più delicata del progetto, perché un errore non produce un errore —
produce utenti anonimi e nessun avviso.

1. L'utente accede: password locale (scrypt) oppure Keycloak (Authorization
   Code + PKCE, id_token verificato su firma, emittente, audience, scadenza e
   nonce).
2. Il browser riceve un cookie di sessione HttpOnly firmato in HMAC-SHA256.
3. All'apertura di una mappa il client chiede
   `POST /api/maps/:id/collab/session`. Il server: apre (o riaggancia) la
   sessione sul relay, e restituisce un **identityToken firmato**.
4. Il client entra nel relay via WebSocket presentando quel token.
5. Il relay lo verifica con il proprio `COLLAB_IDENTITY_SECRET` e popola
   `participant.identity`. Nel roster l'utente compare verificato.

Il formato del token è quello di `@geolibre/collab-core`:

```
<base64url(payloadJSON)>.<base64url(hmacSha256(base64url(payloadJSON))))>
```

con claim `{ userId, username, provider?, exp? }`, `exp` in **secondi**. Due
dettagli sono vincolanti: la firma copre il payload *già codificato* (non
l'oggetto), e il base64url è **senza padding**. `src/server/test/unit/identity-token.test.ts`
verifica entrambi, perché sbagliarli produce esattamente il fallimento
silenzioso descritto sopra.

Tre cose che il server non fa mai, di proposito:

- **non manda il segreto al browser.** Chi lo possiede può presentarsi come
  chiunque;
- **non manda lo `hostToken` a chi non è proprietario.** È quello che abilita
  moderazione e cambio permessi lato relay;
- **non si fida del ruolo dichiarato dal client.** `canEdit` nel ticket viene
  dall'ACL, e le sessioni sono create con `requireIdentity: true`, quindi un
  client con un token inventato non entra affatto.

---

## Permessi

Tutto in `src/server/src/acl.ts`, in un solo posto e in un solo ordine — il più
specifico vince:

1. il proprietario può sempre tutto;
2. una condivisione esplicita per quell'utente;
3. l'accesso generale della mappa (privata / organizzazione / link).

È lo stesso ordine con cui GeoLibre calcola i permessi di sessione
(`participantCanEdit`), scelto per coerenza: due modelli diversi sullo stesso
schermo confondono chiunque debba spiegarli.

Nessun accesso produce **404, non 403**: un 403 rivelerebbe che quella mappa
esiste.

---

## Perché SQLite, e come si esce

`node:sqlite` è nella libreria standard di Node 22.13+: niente compilazione,
niente build tools su Windows, e il progetto si scompatta e parte. È anche il
modulo che usa il relay di GeoLibre, quindi il vincolo di versione è condiviso.

Lo schema (`src/server/src/db.ts`) è SQL portabile: tipi banali, nessuna estensione.
Il passaggio a PostgreSQL tocca quel file e nient'altro. Da rifare in quel
momento: gli `ON CONFLICT ... DO UPDATE` (identici in PostgreSQL) e la scelta se
portare i permessi in Row-Level Security invece che in `acl.ts` — sensato se il
database viene condiviso con altri servizi, inutile se l'API resta l'unico
accesso.

---

## Cosa manca, in ordine di importanza

1. **Istanza GeoLibre self-hosted.** Prima del fork, e più urgente: è ciò che
   sblocca insieme l'API comandi (`GEOLIBRE_EMBED_ORIGINS`), il riferimento per
   URL dei file caricati (niente più tetto a 4 MB) e la sostituzione del marchio.
   Un solo lavoro per tre problemi che oggi sembrano distinti.
2. **Fork della shell GeoLibre.** Toglie il rimontaggio su tema e lingua e
   porta avatar, Condividi e presenza *dentro* la toolbar della mappa. Regola da
   seguire: aggiungere file, non modificarli — un solo punto di innesto nei due
   file di layout, tutto il resto in file nuovi, così i merge da upstream non
   confliggono.
3. **Ruoli di organizzazione.** Oggi l'appartenenza si deduce dal dominio email.
   Con Keycloak i gruppi sono nel token e vanno letti da lì.
4. **Audit.** La tabella `activity` registra già le azioni ma nessuna
   interfaccia la mostra.
