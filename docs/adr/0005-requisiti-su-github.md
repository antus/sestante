# 0005. I requisiti come issue GitHub e un Project

- Stato: accettata
- Data: 2026-10-06

## Contesto

I requisiti sono alcune centinaia, ciascuno con area, copertura, approccio e
stima. Più persone devono poterli creare, modificare, discutere e chiudere, e
vederli legati al codice che li implementa.

## Decisione

- Una **issue per requisito**, con etichetta `requisito`, titolo `R-xxx · …` e
  il modulo [`requisito.yml`](../../.github/ISSUE_TEMPLATE/requisito.yml).
- Il **Project "Requisiti di Sestante"** con campi strutturati (area,
  copertura, stima, priorità) per le viste in tabella e a colonne.
- Le issue sono **pubbliche**: descrivono che cosa deve fare Sestante, non
  documenti o prodotti di terzi.

Dettagli in [`docs/requisiti/`](../requisiti/README.md).

## Conseguenze

- Commit e pull request chiudono i requisiti (`Closes #123`).
- Le stime e la copertura vivono nei campi del Project; per un'analisi fuori
  da GitHub si esportano dalla vista tabella.
