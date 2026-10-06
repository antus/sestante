# Decisioni architetturali

Una decisione per file: il contesto che l'ha resa necessaria, che cosa si è
deciso e che cosa comporta. Servono a chi arriva dopo per capire *perché* il
codice è fatto così, prima di cambiarlo.

Una decisione non si modifica: se cambia idea, se ne scrive una nuova che la
**sostituisce**, e nella vecchia si aggiorna lo stato.

| N. | Decisione | Stato |
| --- | --- | --- |
| [0001](0001-geolibre-senza-fork.md) | GeoLibre senza fork, a una versione fissata, servito da Sestante | accettata |
| [0002](0002-collaborazione.md) | La collaborazione usa il relay di GeoLibre, con Sestante come host | accettata |
| [0003](0003-database.md) | SQLite in locale, PostgreSQL condiviso, dietro la stessa interfaccia | accettata |
| [0004](0004-distribuzioni.md) | Quattro distribuzioni dallo stesso codice | accettata |
| [0005](0005-requisiti-su-github.md) | I requisiti come issue GitHub e un Project | accettata |
| [0006](0006-struttura-del-repository.md) | Struttura del repository per ruolo | accettata |

## Modello

```markdown
# NNNN. Titolo: la decisione, in breve

- Stato: proposta | accettata | sostituita da NNNN
- Data: AAAA-MM-GG

## Contesto
Il problema e i vincoli, senza la soluzione.

## Decisione
Che cosa si fa.

## Conseguenze
Che cosa diventa più facile, che cosa più difficile, che cosa resta da fare.
```
