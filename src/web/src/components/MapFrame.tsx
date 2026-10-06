/**
 * L'istanza GeoLibre incorporata, con il giro completo del progetto.
 *
 * ── Due ponti postMessage, non uno ──────────────────────────────────────────
 * GeoLibre ne espone due, ed è la cosa che va capita per non concludere
 * (sbagliando) che il contenuto di una mappa non sia recuperabile:
 *
 *  1. **API embed v2** — `@geolibre/embed`, messaggi `{v:2, type, payload}`.
 *     Comanda la mappa: setView, setLayerVisibility, addData, exportImage…
 *     Non ha alcun comando per *leggere* il progetto, né per cambiare tema o
 *     lingua a caldo.
 *  2. **Ponte di stato `geolibre:*`** — quello che alimenta il widget Python
 *     (`useEmbedBridge.ts` nel monorepo). Questo il progetto lo trasmette:
 *     pubblica `geolibre:state` con lo snapshot completo — livelli, gruppi,
 *     stili, basemap e camera — a ogni cambiamento dello store, con 250 ms di
 *     debounce; risponde a `geolibre:request-state`; applica
 *     `geolibre:load-project`. Si attiva con `?embed=1` sull'URL.
 *
 * ── Perché tre fasi e non un semplice "carica all'avvio" ────────────────────
 * Un `load-project` inviato troppo presto viene applicato **e poi sovrascritto**
 * dall'avvio dell'app, che monta il proprio progetto (vuoto, o quello che ha in
 * locale) subito dopo. A schermo il livello compare per un istante e sparisce;
 * e se quel progetto vuoto lo salviamo, il lavoro dell'utente è perso davvero.
 * Era esattamente questo il difetto.
 *
 * Quindi:
 *
 *   probing    — si invia solo `request-state`, che è innocuo, finché l'app non
 *                risponde. La sua prima risposta certifica che l'avvio è finito.
 *   restoring  — solo ora si spinge `load-project`, e si chiede conferma. Se lo
 *                snapshot che torna non contiene i livelli attesi, qualcosa li
 *                ha sovrascritti: si riprova, fino a un tetto.
 *   live       — ripristino confermato. Da qui, e solo da qui, gli snapshot
 *                vengono persistiti.
 *
 * La regola che protegge i dati è una sola: **non si salva nulla prima di
 * `live`**. Uno stato di avvio non può cancellare il progetto dell'utente.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { connect, type GeoLibreEmbedClient, type Viewport } from "@geolibre/embed";
import { setBridgeReady } from "../lib/collabBridge";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";

/**
 * Identificativi dei livelli, ordinati: la firma con cui si riconosce se un
 * ripristino ha attecchito.
 *
 * Non si può confrontare il JSON: GeoLibre **normalizza** il progetto quando lo
 * carica (unisce stili, completa i valori impliciti), quindi lo snapshot che
 * rimanda non è mai uguale a quello che gli abbiamo dato. Gli id dei livelli
 * sopravvivono alla normalizzazione.
 */
function layerIds(project: unknown): string[] {
  const layers = (project as { layers?: { id?: unknown }[] } | null)?.layers;
  if (!Array.isArray(layers)) return [];
  return layers
    .map((layer) => (layer && typeof layer.id === "string" ? layer.id : ""))
    .filter(Boolean)
    .sort();
}

type Phase = "probing" | "restoring" | "live";

/**
 * Ciò che l'editor può chiedere alla mappa senza conoscerne il meccanismo.
 *
 * Aggiungere un livello non è "mandare un messaggio": va inserito nel progetto
 * corrente — quello che il ponte ci ha appena consegnato, non quello che
 * avevamo all'apertura — e poi ricaricato per intero, perché `load-project` è
 * l'unico ingresso che il ponte di stato espone. Quella lettura del progetto
 * vivo ce l'ha solo `MapFrame`, ed è il motivo per cui l'operazione sta qui e
 * non in `Editor`.
 */
export interface MapFrameControl {
  /** `true` se il livello è stato consegnato alla mappa. */
  addLayer: (layer: Record<string, unknown>) => boolean;
}

const PROBE_INTERVAL_MS = 600;
const PROBE_MAX_ATTEMPTS = 25;
const RESTORE_MAX_ATTEMPTS = 5;
const CONFIRM_DELAY_MS = 500;
/**
 * Finestra di sorveglianza dopo un ripristino riuscito.
 *
 * Confermare il ripristino non basta: l'avvio dell'app può sovrascrivere il
 * progetto anche **dopo**, un secondo più tardi (è il caso in cui il livello
 * compare nella legenda e poi sparisce). Per questo intervallo, uno snapshot
 * che perde i livelli appena ripristinati viene letto come quella
 * sovrascrittura: non si salva e si ricarica.
 *
 * Il compromesso, dichiarato: se entro cinque secondi dall'apertura l'utente
 * cancellasse davvero tutti i livelli, se li vedrebbe tornare una volta. Costo
 * di sbagliare in questa direzione: un livello da ricancellare. Costo di
 * sbagliare nell'altra: il progetto perso senza preavviso.
 */
const RESTORE_GUARD_MS = 5000;

export function MapFrame({
  baseUrl,
  readOnly,
  collabSession,
  initialProject,
  onProjectChange,
  onClient,
  onControl,
}: {
  baseUrl: string;
  readOnly: boolean;
  /**
   * Sessione del relay in cui GeoLibre deve entrare (collaborazione nella
   * mappa), o null. Cambiarla rimonta la mappa nella sessione nuova.
   */
  collabSession?: string | null;
  /** Progetto salvato da caricare all'apertura; null per una mappa nuova. */
  initialProject?: unknown;
  /** Chiamato solo sugli snapshot da persistere (fase `live`). */
  onProjectChange?: (project: unknown) => void;
  onClient?: (client: GeoLibreEmbedClient | null) => void;
  /** Riceve il controllo quando la mappa è pronta, null quando si smonta. */
  onControl?: (control: MapFrameControl | null) => void;
}) {
  const { locale, t } = useI18n();
  const { resolved } = useTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const clientRef = useRef<GeoLibreEmbedClient | null>(null);
  const viewportRef = useRef<Viewport | null>(null);

  /** Ultimo progetto noto: quello da ripristinare dopo un rimontaggio. */
  const projectRef = useRef<unknown>(initialProject ?? null);
  const phase = useRef<Phase>("probing");
  const restoreAttempts = useRef(0);
  const restoreTarget = useRef<string[]>([]);
  const confirmTimer = useRef<number | undefined>(undefined);
  /** Istante fino al quale una perdita di livelli è considerata sovrascrittura. */
  const guardUntil = useRef(0);

  const [status, setStatus] = useState<"loading" | "ready" | "no-api">("loading");
  const [bridge, setBridge] = useState(false);

  // Il progetto salvato può arrivare dopo il primo render (è una fetch).
  useEffect(() => {
    if (initialProject !== undefined && initialProject !== null && projectRef.current === null) {
      projectRef.current = initialProject;
    }
  }, [initialProject]);

  const remountKey = `${resolved}|${locale}|${collabSession ?? ""}`;

  const origin = (() => {
    try {
      return new URL(baseUrl, window.location.href).origin;
    } catch {
      return "";
    }
  })();

  const source = (() => {
    if (!baseUrl) return "";
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("theme", resolved);
    url.searchParams.set("lang", locale);
    url.searchParams.set("locale", locale);
    // Attiva il ponte di stato: senza, il progetto non si può né leggere né
    // ricaricare.
    url.searchParams.set("embed", "1");
    if (readOnly) url.searchParams.set("layout", "viewer");
    // GeoLibre apre da sé il dialogo "Collabora" su questo codice; l'aggancio
    // lo conferma quando diamo il via (vedi l'effetto più sotto).
    if (collabSession) url.searchParams.set("collab", collabSession);
    return url.toString();
  })();

  const post = useCallback(
    (message: unknown) => {
      const target = frameRef.current?.contentWindow;
      if (!target || !origin) return;
      target.postMessage(message, origin);
    },
    [origin],
  );

  /** Sonda innocua: chiede uno snapshot e fa conoscere al ponte la nostra origine. */
  const probe = useCallback(() => {
    if (phase.current !== "probing") return;
    post({ type: "geolibre:request-state" });
  }, [post]);

  /** Spinge il progetto salvato e programma la richiesta di conferma. */
  const restore = useCallback(() => {
    const project = projectRef.current;
    if (!project) {
      phase.current = "live";
      return;
    }
    if (restoreAttempts.current >= RESTORE_MAX_ATTEMPTS) {
      // Oltre questo, insistere significherebbe litigare con l'app a ogni
      // snapshot. Si passa a `live`: meglio una mappa vuota visibile che un
      // ciclo di ricaricamenti — e il progetto resta comunque nel database.
      phase.current = "live";
      return;
    }
    phase.current = "restoring";
    restoreAttempts.current += 1;
    restoreTarget.current = layerIds(project);
    post({ type: "geolibre:load-project", project });
    // L'app pubblica uno stato da sé quando lo store cambia, ma chiederlo
    // esplicitamente rende la conferma indipendente da quel comportamento.
    window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(
      () => post({ type: "geolibre:request-state" }),
      CONFIRM_DELAY_MS,
    );
  }, [post]);

  /**
   * Inserisce un livello nel progetto vivo e lo ricarica.
   *
   * Si rifiuta di agire prima della fase `live`: durante `probing` e
   * `restoring` il progetto che abbiamo in mano non è ancora quello definitivo,
   * e un `load-project` mandato lì in mezzo verrebbe sovrascritto dall'avvio
   * dell'app — cioè il livello comparirebbe e sparirebbe, che è esattamente il
   * difetto da cui siamo partiti.
   */
  const addLayer = useCallback(
    (layer: Record<string, unknown>): boolean => {
      if (phase.current !== "live") return false;
      const current = (projectRef.current ?? {}) as Record<string, unknown>;
      const layers = Array.isArray(current.layers) ? (current.layers as unknown[]) : [];
      const next = { ...current, layers: [...layers, layer] };
      projectRef.current = next;
      post({ type: "geolibre:load-project", project: next });
      // Si persiste subito, senza aspettare che il ponte ci rimandi lo stato:
      // se l'utente chiudesse la mappa nel frattempo, il livello sarebbe già
      // salvato. Lo snapshot che tornerà fra poco lo confermerà e basta.
      onProjectChange?.(next);
      return true;
    },
    [post, onProjectChange],
  );

  useEffect(() => {
    onControl?.({ addLayer });
    return () => onControl?.(null);
  }, [onControl, addLayer]);

  /* ── Sonda ripetuta: `geolibre:ready` arriva una volta sola e può sfuggire ── */
  useEffect(() => {
    if (!origin) return;
    phase.current = "probing";
    restoreAttempts.current = 0;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (phase.current !== "probing" || attempts > PROBE_MAX_ATTEMPTS) {
        window.clearInterval(timer);
        return;
      }
      probe();
    }, PROBE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(confirmTimer.current);
    };
  }, [origin, remountKey, probe]);

  /* ── Ponte di stato ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!origin) return;

    const onMessage = (event: MessageEvent) => {
      // Due controlli, non uno: l'origine attesa **e** che il messaggio venga
      // proprio dal nostro iframe. Senza il secondo, un'altra finestra della
      // stessa origine potrebbe iniettare uno stato.
      if (event.origin !== origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;

      const data = event.data as { type?: string; project?: unknown };
      if (!data || typeof data.type !== "string") return;

      if (data.type === "geolibre:ready") {
        setBridge(true);
        probe();
        return;
      }

      if (data.type !== "geolibre:state" || !("project" in data)) return;
      setBridge(true);
      const arrived = layerIds(data.project);

      if (phase.current === "probing") {
        // Prima risposta dell'app: l'avvio è concluso. Se c'è un progetto da
        // ripristinare si passa a `restoring`, altrimenti si è già operativi.
        const wanted = layerIds(projectRef.current);
        if (wanted.length > 0 && !wanted.every((id) => arrived.includes(id))) {
          restore();
          return;
        }
        phase.current = "live";
        projectRef.current = data.project;
        onProjectChange?.(data.project);
        return;
      }

      if (phase.current === "restoring") {
        const wanted = restoreTarget.current;
        if (wanted.every((id) => arrived.includes(id))) {
          phase.current = "live";
          // La sorveglianza parte da qui: l'avvio dell'app può ancora
          // sovrascrivere fra un istante.
          guardUntil.current = Date.now() + RESTORE_GUARD_MS;
          projectRef.current = data.project;
          // Non si persiste: è il progetto che avevamo già salvato.
          return;
        }
        // I nostri livelli non ci sono: l'avvio dell'app li ha sovrascritti.
        // Non si salva questo stato, e si riprova.
        restore();
        return;
      }

      // live, ma ancora sotto sorveglianza: uno snapshot che perde i livelli
      // appena ripristinati non è una scelta dell'utente, è l'avvio dell'app.
      if (
        Date.now() < guardUntil.current &&
        restoreTarget.current.length > 0 &&
        !restoreTarget.current.every((id) => arrived.includes(id))
      ) {
        restore();
        return;
      }

      projectRef.current = data.project;
      onProjectChange?.(data.project);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, probe, restore, onProjectChange]);

  /* ── API v2: comandi verso la mappa (facoltativa) ───────────────────────── */
  useEffect(() => {
    if (!frameRef.current || !origin) return;
    let cancelled = false;
    setStatus("loading");

    void (async () => {
      try {
        const client = await connect(frameRef.current as HTMLIFrameElement, {
          origin,
          timeoutMs: 12_000,
        });
        if (cancelled) {
          client.disconnect();
          return;
        }
        clientRef.current = client;
        onClient?.(client);
        setStatus("ready");

        if (viewportRef.current) {
          try {
            await client.setView(viewportRef.current);
          } catch {
            /* una vista non ripristinabile non è motivo per bloccare la mappa */
          }
        }
        client.on("viewChanged", (viewport) => {
          viewportRef.current = viewport as Viewport;
        });
      } catch {
        // Nessun `ready` v2 entro il timeout: l'istanza non ha questa origine in
        // allowlist. Il ponte di stato è un canale diverso e può funzionare lo
        // stesso, quindi qui si segnala solo che i comandi non passano.
        if (!cancelled) setStatus("no-api");
      }
    })();

    return () => {
      cancelled = true;
      clientRef.current?.disconnect();
      clientRef.current = null;
      onClient?.(null);
    };
  }, [remountKey, origin, onClient]);

  useEffect(() => setBridge(false), [remountKey]);

  /*
   * Via libera all'ingresso nella sessione: solo a progetto ripristinato e a
   * sorveglianza conclusa. Entrando prima, lo snapshot della sessione
   * arriverebbe mentre stiamo ancora ripristinando dal database, la
   * sorveglianza lo leggerebbe come una sovrascrittura e ricaricherebbe il
   * progetto — che per un editor verrebbe poi trasmesso a tutta la sessione.
   */
  useEffect(() => {
    setBridgeReady(false);
    if (!collabSession) return;
    const timer = window.setInterval(() => {
      if (phase.current === "live" && Date.now() > guardUntil.current) {
        setBridgeReady(true);
        window.clearInterval(timer);
      }
    }, 300);
    return () => {
      window.clearInterval(timer);
      setBridgeReady(false);
    };
  }, [collabSession, remountKey]);

  if (!baseUrl) {
    return (
      <div className="map-host">
        <div className="map-overlay">{t("editor.noEmbed")}</div>
      </div>
    );
  }

  return (
    <div className="map-host">
      <iframe
        key={remountKey}
        ref={frameRef}
        src={source}
        title="GeoLibre"
        allow="fullscreen; geolocation"
        loading="eager"
        onLoad={probe}
      />
      {status === "loading" && !bridge ? (
        <div className="map-overlay">{t("editor.loading")}</div>
      ) : null}
      {status === "no-api" && !bridge ? (
        <div className="map-note">
          <b>{t("editor.noApi")}</b>
          <span>{t("editor.noApiHint")}</span>
        </div>
      ) : null}
    </div>
  );
}
