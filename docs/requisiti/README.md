# Requisiti

I requisiti di Sestante non stanno in un documento ma su GitHub, dove più
persone possono crearli, discuterli e chiuderli:

- **una issue per requisito** in [antus/sestante](https://github.com/antus/sestante/issues?q=label%3Arequisito),
  con etichetta `requisito`;
- il **Project [Requisiti di Sestante](https://github.com/users/antus/projects/1)**
  per vederli in tabella o a colonne, filtrarli e ordinarli.

## Una issue

Titolo: identificativo `R-xxx` e una frase breve (`R-412 · Esportare la mappa in PDF`).
Si crea dal modulo **Requisito** (Issues → New issue), che chiede:

| Campo | Contenuto |
| --- | --- |
| Area | una delle 17 aree funzionali |
| Descrizione | che cosa deve poter fare chi usa Sestante, e perché |
| Copertura in Sestante | `assente`, `parziale`, `completo` |
| Copertura in GeoLibre | che cosa offre già il motore, se valutato |
| Dove si implementa | plugin, server, client, ponte con GeoLibre, contributo upstream, infrastruttura |
| Approccio e stima | come lo si farebbe, e in quanti giorni (minimo – massimo) |

## Etichette

| Etichetta | Significato |
| --- | --- |
| `requisito` | è un requisito (non un bug né un'attività) |
| `area: …` | l'area funzionale |
| `parziale`, `assente` | quanto lo copre oggi Sestante. I requisiti già coperti sono le issue **chiuse** |
| `via: …` | dove si implementa |

## Il Project

Campi: **Status** (Todo, In Progress, Done), **Area**, **Copertura Sestante**,
**Copertura GeoLibre**, **Stima min** e **Stima max** in giorni, **Priorità**
(P1–P3, la decide il team). Chiudere una issue la porta in Done.

## Importazione

Il primo elenco è stato importato con due script, ripetibili (saltano ciò che
c'è già):

```bash
node build/scripts/requisiti-github.mjs <requisiti.json>    # etichette e issue
node build/scripts/requisiti-project.mjs <requisiti.json>   # Project e campi
```
