# 0002. La collaborazione usa il relay di GeoLibre, con Sestante come host

- Stato: accettata
- Data: 2026-10-06

## Contesto

Gli utenti devono modificare insieme la stessa mappa, in tempo reale, con i
ruoli decisi da Sestante (proprietario, editor, lettore). GeoLibre ha già una
collaborazione con un relay (`workers/collab-node`), ma le sessioni le apre chi
ospita la mappa e non conoscono gli utenti né i permessi di Sestante.

## Decisione

- Si usa il **relay di GeoLibre**, compilato dal sorgente fissato in un unico
  file (`.out/geolibre/relay/relay.cjs`): nel processo del server per l'uso
  locale (`COLLAB_EMBEDDED=1`), come servizio a sé nelle installazioni server.
- **Il server di Sestante è l'host** di ogni sessione: la apre in sola lettura,
  emette un invito alla co-modifica solo per chi può modificare, e la
  sostituisce quando i permessi si restringono.
- L'identità arriva al relay in un **identityToken firmato** (HMAC) con un
  segreto condiviso: chi manomette il browser non può spacciarsi per altri.
- Finché GeoLibre non accetta i parametri necessari, un **aggancio** inserito
  dal server nella configurazione a runtime
  ([`geolibre-bridge.ts`](../../src/server/src/geolibre-bridge.ts)) aggiunge
  token e inviti ai messaggi; la modifica proposta upstream è in
  [`PR-GEOLIBRE-COLLAB.md`](../sviluppo/PR-GEOLIBRE-COLLAB.md).

## Conseguenze

- I permessi della collaborazione li fa rispettare il relay, non il client.
- L'aggancio dipende da dettagli interni di GeoLibre: il build li verifica a
  ogni aggiornamento e si ferma se cambiano.
- Accettata la proposta upstream, aggancio e controlli si tolgono.
