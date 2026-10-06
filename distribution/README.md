# Distribuzioni

Quattro modi di installare Sestante, uno per cartella. Tutti partono dallo
stesso codice e dallo stesso build di GeoLibre, e tutti creano un utente di
default al primo avvio.

| Destinazione | Cartella | Per chi | Si produce con |
| --- | --- | --- | --- |
| eseguibile portabile | [`portable/`](portable) | una persona sul proprio PC Windows, senza installare Node | `npm run build:exe` |
| servizio Windows | [`windows-service/`](windows-service) | un PC o un server Windows che lo tiene sempre acceso | lo stesso zip, cartella `service\` |
| Docker | [`docker/`](docker) | un server con Docker: Sestante, Keycloak, PostgreSQL, relay e HTTPS già configurati | `docker compose up -d --build` |
| Kubernetes | [`kubernetes/`](kubernetes) | un cluster: chart Helm con gli stessi componenti | `helm install` |

## Quale scegliere

- **Uso personale**: l'eseguibile. Modalità `local`, SQLite, collaborazione
  nel processo, nessuna configurazione.
- **Un gruppo piccolo, un server Windows**: il servizio Windows. Per l'accesso
  con Keycloak e PostgreSQL si configura `sestante.env`.
- **Un'organizzazione**: Docker, oppure Kubernetes se c'è già un cluster.
  Modalità `server`, PostgreSQL, Keycloak, relay a sé e TLS.

Tutte le distribuzioni server si possono pubblicare sotto un percorso diverso da
`/` (per esempio `https://host/sestante/`): vedi la sezione "Pubblicare sotto
un percorso" del [README](../README.md).

## File condivisi

Il realm di Keycloak e lo script d'inizializzazione di PostgreSQL stanno nel
chart, in [`kubernetes/sestante/files/`](kubernetes/sestante/files): Helm non
può leggere fuori dalla cartella del chart, e il compose li monta da lì.

## Prodotti

Ciò che si costruisce va in `.out/release/` (eseguibile e zip) o nel registro
delle immagini (Docker e Kubernetes). In `distribution/` ci sono solo le
istruzioni e le configurazioni.
