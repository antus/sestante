# Test di sicurezza

Due strumenti complementari:

| | Cosa fa | Comando |
| --- | --- | --- |
| **casi d'abuso** ([`abuso/`](abuso)) | ogni test è un attacco preciso, che deve fallire | `npm run test:security` |
| **scansione OWASP ZAP** ([`zap/`](zap)) | esplora l'app e segnala i difetti visibili dalle risposte | `npm run test:security:zap` |

## Casi d'abuso

Playwright, contro un server avviato in modalità local con i dati di esempio
(come gli e2e, sulla porta 4181). Le richieste partono dalle API, come le
farebbe chi manomette il client.

| File | Attacchi |
| --- | --- |
| [`autenticazione.spec.ts`](abuso/autenticazione.spec.ts) | rotte protette senza sessione; cookie di sessione falsificato (utente scambiato, firma tolta, scadenza allungata); attributi del cookie; uscita; scoperta degli account dalle risposte; forza bruta sulla password; registrazione con password deboli o account esistenti |
| [`permessi.spec.ts`](abuso/permessi.spec.ts) | mappe e file altrui raggiunti per id (IDOR); un lettore che scrive; un editor che si promuove; file letti o cancellati passando da un'altra mappa o con un percorso relativo; link dei file senza segreto; inviti esauriti, revocati, inventati |
| [`iniezioni.spec.ts`](abuso/iniezioni.spec.ts) | XSS nei nomi delle mappe, nella dashboard di chi le riceve e nell'editor; SQL nella ricerca utenti; campi del tipo sbagliato (oggetti al posto di testo) che non devono causare errori 500; ruolo di proprietario chiesto condividendo; caricamento oltre il limite |
| [`intestazioni.spec.ts`](abuso/intestazioni.spec.ts) | clickjacking (frame-ancestors, X-Frame-Options); MIME sniffing; CSP di GeoLibre; CORS verso un'origine ostile; file caricati serviti come dati e mai come pagina; errori che non espongono dettagli interni |

## Scansione ZAP

`zap-baseline.py` dall'immagine `ghcr.io/zaproxy/zaproxy:stable` (serve Docker):
esplora l'app e analizza le risposte senza attaccarla. Senza `ZAP_TARGET`
avvia da sé un server locale; con `ZAP_TARGET=https://host/sestante/` scansiona
un'installazione esistente.

[`zap/rules.tsv`](zap/rules.tsv) decide la gravità di ogni regola: quelle a
`FAIL` fanno fallire il comando, le altre restano avvisi nel report
(`.out/security/zap/report.html`). Ogni eccezione ha il suo motivo scritto
accanto.

## Quando aggiungere un test

Ogni volta che si apre una nuova rotta o un nuovo modo di condividere: chi non
deve arrivarci, che cosa succede se il corpo è del tipo sbagliato, che cosa
torna indietro. Un difetto trovato diventa prima un test che fallisce, poi la
correzione.
