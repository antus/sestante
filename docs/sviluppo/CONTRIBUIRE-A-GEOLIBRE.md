# Contribuire a GeoLibre

Quando un requisito di Sestante tocca il **core di GeoLibre** (store, pannelli,
motore, API dei plugin) non lo si implementa in un plugin né in un fork da
mantenere: lo si implementa in GeoLibre e lo si propone con una pull request.
Questa guida descrive come farlo provandolo dentro Sestante prima di aprire la
PR. La decisione è [ADR 0007](../adr/0007-modifiche-al-core-di-geolibre.md).

## Prima di cominciare

- **Le regole di GeoLibre** sono in
  [`docs/contributing.md`](https://github.com/opengeos/GeoLibre/blob/main/docs/contributing.md):
  ramo da `main`, modifiche mirate, [Conventional Commits](https://www.conventionalcommits.org/),
  `pre-commit` e `npm run ci:web` prima della PR.
- **Issue prima o dopo.** Per modifiche piccole o medie si può aprire la PR a
  lavoro finito. Per una modifica **grande** GeoLibre chiede di aprire prima una
  issue e concordare l'approccio; in alternativa si apre presto una PR **in
  bozza** (draft) e la si usa come discussione mentre si lavora.
- **Una PR per requisito.** Più piccola è, più è facile che venga accettata.

## Una volta: il fork e il checkout di sviluppo

```bash
gh repo fork opengeos/GeoLibre --clone=false        # crea antus/GeoLibre su GitHub
git clone https://github.com/antus/GeoLibre.git C:\Almaviva\Development\GeoLibre
cd C:\Almaviva\Development\GeoLibre
git remote add upstream https://github.com/opengeos/GeoLibre.git
npm install
```

Il checkout di sviluppo sta **fuori** dal repository di Sestante e non è
`.out/cache/geolibre-src`: quella è la cache del build alla versione fissata,
che lo script riporta sempre al commit del lock.

## Per ogni modifica

1. **Un ramo da `main` aggiornato:**

   ```bash
   git fetch upstream && git switch -c feat/classificazioni upstream/main
   ```

2. **Il ciclo veloce è quello di GeoLibre:** `npm run dev` nel checkout
   (<http://localhost:5173>), con i suoi test (`npm run test:frontend`).

3. **La prova dentro Sestante:** si compila il ramo così com'è, modifiche non
   salvate comprese, e Sestante lo serve su `/gis/`:

   ```bash
   # nella cartella di Sestante
   npm run build:geolibre -- --src C:\Almaviva\Development\GeoLibre
   npm run dev                     # oppure npm run test:e2e
   ```

   Il build verifica anche i punti su cui si appoggia l'aggancio della
   collaborazione: se la modifica li tocca, lo dice subito. Per tornare alla
   versione fissata basta `npm run setup`.

4. **Prima della PR**, nel checkout di GeoLibre:

   ```bash
   pre-commit run --files <i file modificati>   # oppure: python -m pre_commit run --files …
   npm run ci:web
   ```

   `pre-commit` si installa una volta con `python -m pip install --user pre-commit`;
   su Windows, se il comando non si trova, `python -m pre_commit` funziona
   comunque.

   e in Sestante gli e2e (`npm run test:e2e`) con il build del ramo.

5. **La PR**, dal fork verso `opengeos/GeoLibre:main`, con il modulo di
   GeoLibre compilato (Summary, Testing, Related issue):

   ```bash
   git push -u origin feat/classificazioni
   gh pr create --repo opengeos/GeoLibre --base main --head antus:feat/classificazioni
   ```

   Nel requisito di Sestante si aggiunge il link alla PR.

## Se serve prima del merge

Se la modifica deve arrivare ad altri (colleghi, l'immagine Docker, la CI)
prima che GeoLibre la accetti, il lock di Sestante può puntare al ramo sul fork:

```bash
npm run geolibre:use -- feat/classificazioni --repo antus/GeoLibre
npm run build:geolibre
```

Nel lock finiscono il repository del fork e l'hash del commit, quindi il build
resta ripetibile. È **temporaneo** e si vede: `npm run geolibre:use` lo segnala
finché il lock non torna al GeoLibre ufficiale.

## Dopo

- **PR accettata**: alla prima release che la contiene si torna al GeoLibre
  ufficiale e si chiude il requisito.

  ```bash
  npm run geolibre:use -- v3.4.0 --repo opengeos/GeoLibre
  npm run setup
  ```

- **PR rifiutata o ferma**: si decide caso per caso se rifare la funzione come
  plugin, adattarla a ciò che chiedono i maintainer o rinunciarvi. Un fork
  mantenuto nel tempo resta escluso ([ADR 0001](../adr/0001-geolibre-senza-fork.md)).
