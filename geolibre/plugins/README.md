# Plugin GeoLibre di Sestante

Una cartella per plugin, già compilata nella forma che GeoLibre si aspetta:

```
<id-plugin>/
  plugin.json     { "id", "name", "version", "entry", "style"?, "activeByDefault"? }
  dist/index.js   bundle ESM autonomo
  dist/style.css  facoltativo
```

`scripts/build-geolibre.mjs` copia ogni cartella in
`apps/geolibre-desktop/public/plugins/<id>/` prima della build: è il punto di
estensione previsto da GeoLibre per i plugin inclusi nel build, e non richiede
di modificare il suo codice.

Punto di partenza consigliato: <https://github.com/opengeos/geolibre-plugin-template>.
