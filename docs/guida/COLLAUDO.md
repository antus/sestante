# Guida al collaudo

Percorso completo di verifica, in ordine. Ogni prova dice **cosa fare** e
**cosa devi vedere** — se vedi altro, è un difetto e vale la pena segnalarlo.

Tempo indicativo: 25 minuti per tutto, 5 minuti per i soli punti 1–4.

---

## 0. Prerequisiti

```powershell
node -v          # deve dire v22.13.0 o superiore
cd sestante
copy .env.example .env
npm run setup
```

**Attesa:** `npm run setup` finisce con il riepilogo del database — 5 utenti,
6 mappe, e la riga `Accedi con m.antonini@example.org / sestante2026`.

Il file `.env` serve per il punto 8 (presenza). Senza, tutto il resto funziona
lo stesso: l'applicazione dichiara da sola quali funzioni sono attive.

### Credenziali

| Utente                       | Password       | Serve per                                        |
| ---------------------------- | -------------- | ------------------------------------------------ |
| `m.antonini@example.org`     | `sestante2026` | l'utente principale: proprietario di 3 mappe     |
| `e.ricci@example.org`        | `sestante2026` | seconda identità per la presenza                 |
| `s.lombardi@example.org`     | `sestante2026` | **sola lettura**: serve al punto 7               |
| `d.colombo@example.org`      | `sestante2026` | editor su "Rete di monitoraggio"                 |
| `gis@protezionecivile.example.net`    | `sestante2026` | utente esterno al dominio example.org            |

---

## 1. Test automatici

```powershell
npm test
```

**Attesa:** `# pass 29`, `# fail 0`.

Coprono le tre cose in cui un errore non si vede a schermo:

- **`identity-token.test.ts`** — il formato del token che il relay GeoLibre
  verifica. Controlla che la firma copra il payload *codificato* e non
  l'oggetto, che il base64url sia senza padding, che un payload manomesso non
  passi, che `exp` sia interpretato in secondi, e che senza segreto ogni token
  risulti anonimo. Se questi falliscono, la presenza smette di essere
  attendibile **senza alcun errore visibile**.
- **`acl.test.ts`** — ogni combinazione di ruolo esplicito e accesso generale,
  incluso che una mappa privata sia invisibile a chi non è invitato.
- **`auth.test.ts`** — password, sessioni firmate, e il collegamento fra un
  account locale e lo stesso indirizzo che poi arriva da Keycloak.

---

## 2. Avvio

```powershell
npm run dev
```

**Attesa:** due processi con prefisso colorato, `server` e `client`, e le righe
`client http://localhost:5173` / `API http://localhost:4000`.

Apri <http://localhost:5173>.

---

## 3. Accesso locale

| # | Cosa fare | Cosa devi vedere |
|---|-----------|------------------|
| 3.1 | Password sbagliata su `m.antonini@example.org` | «Email o password non corretti.» — **non** "utente inesistente": il messaggio è identico per email sconosciuta e password errata, di proposito |
| 3.2 | Email inesistente, es. `nessuno@example.org` | Stesso identico messaggio, e con lo stesso tempo di risposta |
| 3.3 | Password corretta `sestante2026` | Entri nella dashboard |
| 3.4 | Sbaglia 9 volte di fila | Dal nono tentativo: «Troppi tentativi. Riprova fra qualche minuto.» (limite: 8 in 5 minuti per coppia email+IP) |
| 3.5 | Esci dal menu avatar, poi ricarica la pagina | Resti fuori: il cookie di sessione è stato cancellato |
| 3.6 | Rientra, poi chiudi e riapri il browser | Sei ancora dentro — la sessione dura 12 ore |

**Il pulsante SSO non c'è**, ed è corretto: `KEYCLOAK_ISSUER` è vuoto. Il punto 9
spiega come attivarlo.

### 3.7 — Registrazione

"Non hai un account? Registrati". Prova nell'ordine:

- password `breve1` → «La password deve avere almeno 10 caratteri.»
- password `soltantolettere` → «La password deve contenere lettere e numeri.»
- email `m.antonini@example.org` → «Esiste già un account con questa email.»
- email nuova + password `collaudo2026` → entri, e la dashboard è vuota

Con l'utente nuovo verifica anche che **non veda** le mappe private di Massimo:
in "Le mie mappe" e "Condivise con me" non deve comparire nulla.

---

## 4. Dashboard

| # | Cosa fare | Cosa devi vedere |
|---|-----------|------------------|
| 4.1 | Accedi come Massimo | "Le mie mappe" mostra 3 schede; il contatore accanto alla voce di menu dice 3 |
| 4.2 | "Condivise con me" | 3 mappe, con targhetta **Può modificare** o **Sola lettura**, mai Proprietario |
| 4.3 | Scrivi `tevere` nella ricerca | Resta solo "Rete di monitoraggio — Lazio" (la ricerca guarda nome *e* descrizione) |
| 4.4 | Svuota la ricerca | Tornano tutte |
| 4.5 | Guarda le targhette di visibilità sulle anteprime | Lucchetto = Privata, edificio = Organizzazione, catena = Link pubblico |
| 4.6 | "Nuova mappa" | Viene creata e si apre subito l'editor; tornando indietro è in cima all'elenco, Privata, con te come proprietario |

---

## 5. Tema e lingua

Sono la richiesta originale, quindi meritano attenzione.

| # | Cosa fare | Cosa devi vedere |
|---|-----------|------------------|
| 5.1 | Icona tema → Scuro | Tutta l'interfaccia passa alla scala scura di GeoLibre; anche le anteprime cambiano (acqua e terre) |
| 5.2 | → Sistema, poi cambia il tema di Windows | L'applicazione segue senza ricaricare |
| 5.3 | Nel menu tema, prova i cinque pallini colorati | Cambiano solo pulsanti, targhette e accenti. I grigi restano identici: è il comportamento degli schemi d'accento di GeoLibre |
| 5.4 | Icona globo → Inglese | Tutta l'interfaccia passa all'inglese, incluse le date relative ("3 hours ago") |
| 5.5 | Ricarica la pagina (F5) | Tema, accento e lingua sono quelli che avevi scelto |
| 5.6 | Apri una mappa e cambia lingua **dentro l'editor** | La mappa GeoLibre viene **ricaricata**. È il limite dichiarato: il protocollo embed non ha comandi per cambiare lingua a caldo, quindi l'iframe viene rimontato e la vista ripristinata |

---

## 6. Condivisione

Apri "Rete di monitoraggio — Lazio" come Massimo, poi **Condividi**.

| # | Cosa fare | Cosa devi vedere |
|---|-----------|------------------|
| 6.1 | Guarda l'elenco | Massimo con targhetta Proprietario (senza menu a tendina), poi 4 persone con i rispettivi ruoli |
| 6.2 | Invita `nuovo.collega@example.org` come "Può modificare" | Compare nell'elenco; notifica «Invito inviato a…». L'account non esisteva: viene creato in attesa, e la condivisione lo aspetta al primo accesso |
| 6.3 | Reinvita lo stesso indirizzo come "Può visualizzare" | Il ruolo **cambia**, non si crea un doppione |
| 6.4 | Su una persona scegli "Rimuovi" | Sparisce; notifica «Accesso revocato» |
| 6.5 | Accesso generale → "Chiunque abbia il link" | Il menu del ruolo si abilita |
| 6.6 | → "Solo le persone invitate" | Il menu del ruolo si disabilita: senza accesso generale non c'è un ruolo da assegnare |
| 6.7 | "Copia" | Notifica «Link copiato». Incollalo: è `http://localhost:5173/m/<id>` |
| 6.8 | Apri quel link in una scheda nuova | Si apre direttamente quella mappa, senza passare dalla dashboard |
| 6.9 | Chiudi, riapri Condividi | Le modifiche sono state salvate sul server, non solo a schermo |

---

## 6-bis. Salvataggio e ripristino della configurazione

Questa è la prova che i livelli che aggiungi sopravvivono.

| # | Cosa fare | Cosa devi vedere |
|---|-----------|------------------|
| 6b.1 | Apri una mappa e aggiungi un livello **WMS** dal pannello di GeoLibre | Dopo un secondo, in alto l'indicatore passa da «Salvato» a «Salvataggio…» e torna a «Salvato» |
| 6b.2 | Cambia stile o basemap, sposta la vista | Stessa cosa: ogni modifica viene persistita |
| 6b.3 | Torna alle mappe e riapri la stessa | I livelli e lo stile sono quelli che avevi lasciato |
| 6b.4 | Cambia tema mentre la mappa è aperta | L'iframe viene ricreato, ma i livelli tornano da soli |
| 6b.5 | Come Sara (sola lettura), apri la mappa e prova a cambiare qualcosa | Nulla viene salvato: il client non invia e il server risponderebbe comunque 403 |

### 6-ter. File GeoJSON — usa «Aggiungi dati» di Sestante, non quello di GeoLibre

Sono due pulsanti diversi e fanno cose diverse. Quello **di GeoLibre** apre il
file dal tuo disco: il livello si vede subito, ma alla riapertura non c'è più.
Non è un difetto di Sestante — quando GeoLibre trasmette il progetto verso la
pagina che lo incorpora, per quei livelli scarta deliberatamente la geometria e
conserva solo il percorso del file sul tuo computer, che per noi e per chi
riceve la condivisione non significa nulla. Nel suo codice è una riga sola:

    if (e.geojson && e.metadata.localFileReloadable === true) { togli geojson }

Quello **di Sestante** (in alto a sinistra, accanto a «Condividi») carica il
file sul server, dove diventa una risorsa della mappa con i permessi della
mappa.

| # | Cosa fare | Cosa devi vedere |
|---|-----------|------------------|
| 6t.1 | Con la mappa aperta, «Aggiungi dati» → scegli un `.geojson` | Il livello compare nella legenda di GeoLibre e l'indicatore passa da «Salvataggio…» a «Salvato» |
| 6t.2 | Torna alle mappe e riapri la stessa | **Il livello è ancora lì, con i suoi elementi.** È la prova che conta |
| 6t.3 | Prova con un file che non è GeoJSON (un `.txt` rinominato) | «Il file non contiene JSON leggibile» — e sul server non resta nulla |
| 6t.4 | Prova con un JSON valido ma senza `type` GeoJSON | «Il file non è un GeoJSON valido» |
| 6t.5 | Condividi la mappa con Sara e falla aprire a lei | Vede il livello: il file è servito dal server, non dal tuo disco |
| 6t.6 | Come Sara (sola lettura) | Il pulsante «Aggiungi dati» non c'è, e il server rifiuterebbe con 403 |
| 6t.7 | Cancella la mappa e guarda `data/uploads/` | La cartella della mappa è sparita con lei |

**Se un livello compare nella legenda ma la mappa resta vuota**, il campo `type`
del livello non vale `"geojson"`. È il discriminante con cui GeoLibre decide se
disegnarlo, e sbagliarlo non produce alcun errore visibile. Per controllare cosa
c'è davvero nel progetto salvato:

```powershell
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('./data/sestante.sqlite');for(const r of d.prepare('SELECT name, project_json FROM maps WHERE project_json IS NOT NULL').all()){const p=JSON.parse(r.project_json);console.log(r.name);for(const L of p.layers??[])console.log('  ', L.name, '| type:', L.type, '| elementi:', L.geojson?.features?.length ?? '-')}"
```

I file caricati stanno in `data/uploads/<id-mappa>/<id-file>`, accanto al
database:

```powershell
dir data\uploads /s
```

**Sul messaggio «i dati sono salvati dentro la mappa».** Con
`GEOLIBRE_URL=https://web.geolibre.app` è quello che vedrai, ed è corretto: una
pagina servita in https non può caricare una risorsa in http, e il browser
blocca la richiesta prima ancora di inviarla. Sestante se ne accorge e mette la
geometria dentro il progetto invece che referenziarla per URL. Funziona, ma il
progetto pesa quanto il file, e sopra i 4 MB il caricamento viene rifiutato con
un messaggio esplicito. Servendo GeoLibre sullo stesso schema di Sestante — cioè
un'istanza vostra — si passa da soli al riferimento per URL, e il limite sparisce.

Per vedere cosa c'è davvero nel database:

```powershell
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('./data/sestante.sqlite');for(const r of d.prepare('SELECT name, length(project_json) AS bytes FROM maps').all())console.log(r.name, r.bytes ?? 'vuoto')"
```

**Se l'indicatore non si muove mai**, il ponte di stato non è attivo: serve
un'istanza GeoLibre che risponda su `?embed=1`. Con `GEOLIBRE_URL` sull'istanza
pubblica dovrebbe funzionare comunque, perché l'opt-in esplicito attiva il
ponte qualunque sia la pagina che incorpora.

---

## 7. Permessi — la prova che conta

Apri una **finestra in incognito** (Ctrl+Maiusc+N) e accedi come
`s.lombardi@example.org`. Sara è **sola lettura** su "Rete di monitoraggio".

| # | Cosa fare | Cosa devi vedere |
|---|-----------|------------------|
| 7.1 | Apri "Rete di monitoraggio — Lazio" | Notifica «Hai accesso in sola lettura a questa mappa»; nella barra di stato, **Sola lettura** |
| 7.2 | Prova a modificare il nome del progetto in alto | Il campo è disabilitato |
| 7.3 | Apri Condividi | Vedi l'elenco ma **non** il campo di invito; i ruoli sono targhette, non menu. In fondo: «Solo il proprietario può modificare gli accessi» |
| 7.4 | In "Le mie mappe" | Vuoto: Sara non possiede nulla |
| 7.5 | Prendi l'id di una mappa **privata** di Massimo e apri `http://localhost:5173/m/<quell-id>` | Vieni riportato alla dashboard: il server risponde 404, non 403, per non rivelare che quella mappa esiste |

### 7.6 — Verifica dal lato server

La parte importante è che i permessi non siano solo grafica. In un terzo
terminale (PowerShell — usa `curl.exe`, non `curl`, che è un alias di
`Invoke-WebRequest`):

```powershell
# accedi come Sara e conserva il cookie
curl.exe -s -c sara.txt -o nul http://localhost:4000/api/auth/login `
  -H "content-type: application/json" `
  -d "{\"email\":\"s.lombardi@example.org\",\"password\":\"sestante2026\"}"

# prendi l'id della prima mappa che Sara può vedere
curl.exe -s -b sara.txt "http://localhost:4000/api/maps?scope=shared"

# prova a rinominarla: deve rispondere 403
curl.exe -s -o nul -w "%{http_code}`n" -X PATCH -b sara.txt `
  http://localhost:4000/api/maps/<ID>/ -H "content-type: application/json" `
  -d "{\"name\":\"tentativo\"}"

# prova a invitare qualcuno: deve rispondere 403
curl.exe -s -o nul -w "%{http_code}`n" -b sara.txt `
  http://localhost:4000/api/maps/<ID>/shares -H "content-type: application/json" `
  -d "{\"email\":\"x@example.org\",\"role\":\"editor\"}"
```

**Attesa:** `403` a entrambe. Se ottieni `200`, è un difetto di sicurezza e va
segnalato subito.

---

## 8. Presenza: chi è connesso

Serve il relay di collaborazione di GeoLibre. In un secondo terminale:

```powershell
npm run relay
```

La prima volta scarica GeoLibre in `vendor\GeoLibre` (un paio di minuti).

**Attesa:** `Relay di collaborazione GeoLibre — porta 8787`. Verifica:

```powershell
curl.exe http://localhost:8787/health
# {"ok":true,"service":"geolibre-collab","identitySupported":true}

curl.exe http://localhost:4000/api/collab/status
# {"enabled":true,"reachable":true,"identitySupported":true}
```

`identitySupported: true` da **entrambe** le parti significa che il segreto
condiviso è arrivato. Se il relay dice `false`, `COLLAB_IDENTITY_SECRET` non è
stato letto: senza, tutti entrerebbero anonimi e non te ne accorgeresti.

Poi, con il server già avviato **dopo** il relay (riavvia `npm run dev` se lo
avevi aperto prima):

| # | Cosa fare | Cosa devi vedere |
|---|-----------|------------------|
| 8.1 | Come Massimo apri "Rete di monitoraggio" | Barra di stato: pallino verde e «Sessione collaborativa» |
| 8.2 | In incognito, come Elena Ricci, apri la **stessa** mappa | In entrambe le finestre, in alto a destra compare l'avatar dell'altro con l'anello verde; la barra dice «2 connessi» |
| 8.3 | Passa il puntatore sull'avatar | Il nome completo. Se dicesse "(anonimo)", l'identità non è stata verificata: controlla il segreto |
| 8.4 | Chiudi la finestra in incognito | Entro pochi secondi l'avatar sparisce e il contatore torna a 1 |
| 8.5 | Ferma il relay (Ctrl+C) e ricarica | «Relay non raggiungibile». Riavvialo: l'applicazione si ricollega da sola con backoff |

---

## 9. Keycloak (facoltativo)

Configura il client come descritto in `docs/guida/CONFIGURAZIONE.md`, poi nel `.env`:

```bash
KEYCLOAK_ISSUER=https://sso.example.org/realms/sestante
KEYCLOAK_CLIENT_SECRET=...
```

Riavvia. **Attesa:** nella pagina di accesso compare «Continua con SSO
aziendale», e nel riepilogo di avvio del server leggi `Autenticazione: locale +
Keycloak`.

Da provare: dopo il rientro, il menu avatar deve dire **Keycloak SSO** invece di
Account locale. Se usi un indirizzo che esisteva già come account locale, deve
essere lo **stesso** account — non un doppione — e da quel momento la vecchia
password non accede più.

---

## 10. Cosa non funzionerà, ed è previsto

**La mappa mostra un avviso «API runtime non disponibile».** È corretto:
`GEOLIBRE_URL` punta a `web.geolibre.app`, che non dichiara alcuna origine in
allowlist e ignora i comandi `postMessage`. La mappa si vede e si naviga, ma non
è pilotabile da Sestante. Per l'API serve un'istanza vostra avviata con
`GEOLIBRE_EMBED_ORIGINS` (comando Docker in `docs/guida/CONFIGURAZIONE.md`).

**Senza internet la mappa resta vuota.** Le tile e l'applicazione GeoLibre
arrivano dalla rete; il resto di Sestante funziona offline.

**Il logo GeoLibre non si può togliere.** L'iframe è un'altra origine: il
browser non consente di modificarne né il DOM né il CSS, e non è aggirabile.
Con un'istanza self-hosted sì, ed è legittimo — GeoLibre è MIT, l'unico obbligo
è conservare il file di copyright.

**Un file GeoJSON grande viene rifiutato.** Vedi la nota in fondo alla sezione
6-ter: è la stessa causa dell'avviso qui sopra, cioè l'istanza pubblica in
https. Tre sintomi, una sola cura.

---

## 11. Ripartire da zero

```powershell
npm run db:reset
```

Ricrea il database con i dati di esempio. Cancella tutto: account creati da te,
inviti, condivisioni modificate.

---

## Riepilogo

| Area | Prova | Esito |
|------|-------|-------|
| Test automatici | 29 passati | ☐ |
| Accesso locale | credenziali, messaggi identici, limite tentativi | ☐ |
| Registrazione | policy password, email duplicata | ☐ |
| Dashboard | elenchi, ricerca, nuova mappa | ☐ |
| Tema | chiaro/scuro/sistema + 5 accenti, persistenti | ☐ |
| Lingua | IT/EN su tutta l'interfaccia, date incluse | ☐ |
| Condivisione | invito, cambio ruolo, revoca, accesso generale, link | ☐ |
| Permessi UI | sola lettura: campi disabilitati, invito nascosto | ☐ |
| Permessi API | 403 su modifica e invito, 404 su mappa privata | ☐ |
| Presenza | 2 connessi, identità verificata, riconnessione | ☐ |
| Keycloak | SSO, collegamento account | ☐ |
