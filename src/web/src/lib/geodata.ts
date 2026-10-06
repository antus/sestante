/**
 * Dal file GeoJSON al livello GeoLibre.
 *
 * ── Perché questo modulo esiste ─────────────────────────────────────────────
 * Un livello che l'utente apre con il selettore di file **di GeoLibre** non
 * sopravvive alla chiusura della mappa. Non è un difetto di Sestante: quando
 * GeoLibre trasmette il progetto verso la pagina che lo incorpora, per quei
 * livelli scarta deliberatamente la geometria. Nel suo codice è una riga sola:
 *
 *     if (e.geojson && e.metadata.localFileReloadable === true) { togli geojson }
 *
 * Il ragionamento di GeoLibre è sensato per il caso suo — il file sta sul disco
 * dell'utente, lo ricaricherà da lì — ma per noi significa ricevere un livello
 * senza dati, e infatti alla riapertura non c'era più nulla. Un WMS invece
 * porta un URL raggiungibile, e per questo si ricaricava.
 *
 * La via d'uscita è caricare il file **da Sestante**, non da GeoLibre: il
 * livello che costruiamo qui non ha `localFileReloadable`, quindi GeoLibre non
 * ha ragione di scartarne i dati e lo restituisce intero a ogni snapshot.
 */

/** Il sottoinsieme di GeoJSON che ci serve conoscere. */
interface Feature {
  geometry?: { type?: string } | null;
}
export interface GeoJson {
  type: string;
  features?: Feature[];
  geometry?: { type?: string } | null;
}

const ROOT_TYPES = new Set([
  "FeatureCollection",
  "Feature",
  "GeometryCollection",
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);

export function isGeoJson(value: unknown): value is GeoJson {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GeoJson).type === "string" &&
    ROOT_TYPES.has((value as GeoJson).type)
  );
}

export function featureCount(value: GeoJson): number {
  return Array.isArray(value.features) ? value.features.length : 1;
}

/**
 * Stile minimo. GeoLibre normalizza il progetto quando lo carica e completa da
 * sé le decine di proprietà che mancano, quindi elencarle qui significherebbe
 * solo duplicare i suoi valori predefiniti e restare indietro al primo
 * aggiornamento.
 */
const BASE_STYLE = {
  minZoom: 0,
  maxZoom: 24,
  fillColor: "#3b82f6",
  strokeColor: "#1e40af",
  strokeWidth: 2,
  fillOpacity: 0.6,
  circleRadius: 6,
};

export interface BuiltLayer {
  id: string;
  name: string;
  /** Sempre "geojson": vedi la nota in `buildLayer`. */
  type: "geojson";
  source: { type: "geojson"; data?: string };
  geojson?: GeoJson;
  visible: boolean;
  opacity: number;
  style: typeof BASE_STYLE;
  metadata: Record<string, unknown>;
}

/**
 * Costruisce il livello. Due modi di portare i dati, e la scelta non è di gusto:
 *
 *   `inline` — la geometria sta **dentro** il progetto (`geojson`), che è ciò
 *     che Sestante salva. Nessuna richiesta di rete, quindi funziona anche
 *     quando l'istanza GeoLibre è su https e Sestante su http (vedi sotto).
 *     Costo: il progetto cresce quanto il file.
 *
 *   `url` — il livello referenzia il file servito da Sestante
 *     (`source.data`, che è come GeoLibre stessa riconosce un livello vettoriale
 *     remoto). Il progetto resta leggero e il file si scarica una volta sola.
 *     Costo: la richiesta deve poter partire dall'iframe.
 *
 * ── Il vincolo che decide, e perché non è aggirabile da qui ─────────────────
 * Una pagina servita in https non può caricare una risorsa in http: il browser
 * blocca la richiesta *prima* di inviarla (mixed content). Con
 * `GEOLIBRE_URL=https://web.geolibre.app` e Sestante su `http://localhost`,
 * quindi, il modo `url` produrrebbe un livello che non si carica mai — e la
 * misura sul campo lo conferma: perfino una fetch in `mode:"no-cors"`, dove un
 * errore CORS è impossibile per costruzione, fallisce.
 *
 * Da qui la regola in `pickMode`. La vera soluzione è servire GeoLibre e
 * Sestante sullo stesso schema — cioè un'istanza GeoLibre self-hosted, che
 * serve comunque per l'API comandi e per il marchio.
 */
export function buildLayer(options: {
  id: string;
  name: string;
  geojson: GeoJson;
  /** Presente solo in modo `url`. */
  url?: string;
}): BuiltLayer {
  const { id, name, geojson, url } = options;
  return {
    id,
    name,
    // ── Questo valore è la differenza fra un livello che si vede e uno che no ──
    // Deve essere esattamente "geojson". Non è il tipo *geometrico*: quello
    // GeoLibre lo deduce da sé dai dati. È il discriminante con cui decide se
    // il livello è materializzabile, e un livello che non lo è compare nella
    // legenda ma non viene mai disegnato — nessun errore, nessun avviso,
    // semplicemente una mappa vuota.
    //
    // Lo dice il suo costruttore, `addGeoJsonLayer`:
    //   {id, name, type: "geojson", source: {type: "geojson"}, …, geojson: n}
    // e lo conferma la funzione che calcola le capacità del livello, dove
    // `create` e `update` valgono `e.type === "geojson" && …`.
    //
    // Era "circle"/"fill", dedotto dalla prima geometria: sembrava ragionevole
    // e non lo era.
    type: "geojson",
    source: url ? { type: "geojson", data: url } : { type: "geojson" },
    ...(url ? {} : { geojson }),
    visible: true,
    opacity: 1,
    style: { ...BASE_STYLE },
    // Vuoto di proposito. `localFileReloadable` e `externalNativeLayer` sono i
    // due contrassegni per cui GeoLibre scarta la geometria in uscita: non
    // metterli non è una dimenticanza, è il punto.
    metadata: {},
  };
}

/** Oltre questa soglia il progetto diventa troppo pesante per essere incorporato. */
export const INLINE_MAX_BYTES = 4 * 1024 * 1024;

export type Mode = "inline" | "url" | "too-large";

/**
 * `sestanteOrigin` e `geolibreUrl` sono le due origini in gioco; `size` è il
 * peso del file serializzato.
 */
export function pickMode(options: {
  size: number;
  sestanteOrigin: string;
  geolibreUrl: string;
}): Mode {
  const { size, sestanteOrigin, geolibreUrl } = options;
  let blocked = false;
  try {
    blocked =
      new URL(geolibreUrl, sestanteOrigin).protocol === "https:" &&
      new URL(sestanteOrigin).protocol === "http:";
  } catch {
    blocked = false;
  }
  if (!blocked) return "url";
  // Bloccati sul modo `url`: resta l'incorporamento, finché il file ci sta.
  return size <= INLINE_MAX_BYTES ? "inline" : "too-large";
}
