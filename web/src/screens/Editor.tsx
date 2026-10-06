/**
 * Editor: la barra di Sestante sopra, l'istanza GeoLibre sotto.
 *
 * È esattamente la divisione del lavoro concordata. GeoLibre porta tutto ciò
 * che è cartografico — livelli, stile, elaborazione, tabella attributi, i suoi
 * 6.500 elementi di interfaccia. Sestante porta ciò che GeoLibre non ha e che
 * comunque dovrebbe restare vostro: identità, avatar, ruoli, condivisione e
 * l'elenco di chi è connesso in questo momento.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type MapSummary, type PublicUser, type ServerConfig } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Icon } from "../lib/icons";
import { Avatar } from "../components/ui";
import { LanguageButton, ThemeButton, UserButton } from "../components/TopBarControls";
import { MapFrame, type MapFrameControl } from "../components/MapFrame";
import { ShareDialog } from "../components/ShareDialog";
import { useCollabPresence } from "../lib/collab";
import { buildLayer, isGeoJson, pickMode, type GeoJson } from "../lib/geodata";

export function Editor({
  map: initialMap,
  user,
  config,
  collabEnabled,
  onBack,
  onLogout,
  onToast,
}: {
  map: MapSummary;
  user: PublicUser;
  config: ServerConfig;
  /** null = non ancora noto. */
  collabEnabled: boolean | null;
  onBack: () => void;
  onLogout: () => void;
  onToast: (message: string) => void;
}) {
  const { t, relative } = useI18n();
  const [map, setMap] = useState(initialMap);
  const [name, setName] = useState(initialMap.name);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  /** Progetto GeoLibre salvato, caricato all'apertura della mappa. */
  const [project, setProject] = useState<unknown>(undefined);
  const projectTimer = useRef<number | undefined>(undefined);
  /** Modifica non ancora scritta sul server: `undefined` = niente in sospeso. */
  const pendingProject = useRef<unknown>(undefined);
  /** Controllo della mappa: disponibile solo quando l'iframe è operativo. */
  const control = useRef<MapFrameControl | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const canEdit = map.role === "owner" || map.role === "editor";
  // `user.id` è ciò che permette alla presenza di riconoscere noi stessi:
  // è lo stesso valore che il server mette nel claim `userId` del token
  // firmato, e che il relay restituisce in `identity.userId`.
  const presence = useCollabPresence(map.id, collabEnabled, user.id);

  // Il progetto non viaggia nell'elenco (sarebbe pesante): si chiede all'apertura.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.map(map.id);
        if (!cancelled) setProject(result.project ?? null);
      } catch {
        if (!cancelled) setProject(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [map.id]);

  /**
   * Salvataggio del progetto: ogni snapshot che GeoLibre pubblica sul ponte di
   * stato viene persistito, con un ritardo che accorpa la raffica prodotta da
   * una singola azione dell'utente. GeoLibre debounce già a 250 ms lato suo;
   * qui si aggiunge un secondo perché una richiesta HTTP costa più di un
   * postMessage. Chi ha accesso in sola lettura non salva nulla — e comunque
   * il server rifiuterebbe con 403.
   */
  const flushProject = useCallback(
    async (options: { keepalive?: boolean } = {}) => {
      const next = pendingProject.current;
      if (next === undefined) return;
      pendingProject.current = undefined;
      window.clearTimeout(projectTimer.current);
      setSaving(true);
      try {
        await api.updateMap(map.id, { project: next }, options);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "generic";
        const key = `err.${code}` as "err.generic";
        const message = t(key);
        onToast(message === key ? t("err.generic") : message);
      } finally {
        setSaving(false);
      }
    },
    [map.id, onToast, t],
  );

  const persistProject = useCallback(
    (next: unknown) => {
      if (!canEdit) return;
      pendingProject.current = next;
      window.clearTimeout(projectTimer.current);
      projectTimer.current = window.setTimeout(() => void flushProject(), 1000);
    },
    [canEdit, flushProject],
  );

  /**
   * Alla chiusura della mappa la modifica in sospeso va scritta, non buttata.
   *
   * Era un difetto vero: aggiungere un livello e chiudere entro il secondo di
   * attesa significava perderlo, perché la pulizia dell'effetto annullava il
   * timer e basta. Ora si invia subito, con `keepalive`, così il browser porta
   * a termine la richiesta anche mentre la pagina cambia.
   */
  useEffect(() => {
    const onLeave = () => void flushProject({ keepalive: true });
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onLeave);
      window.clearTimeout(projectTimer.current);
      void flushProject({ keepalive: true });
    };
  }, [flushProject]);

  useEffect(() => {
    if (map.role === "viewer") onToast(t("toast.readonly"));
    // Una sola volta all'apertura: il ruolo non cambia sotto i piedi
    // dell'utente senza un ricaricamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Rinomina con salvataggio differito: una richiesta per pausa di battitura. */
  const renameLater = useCallback(
    (next: string) => {
      setName(next);
      if (!canEdit) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        setSaving(true);
        try {
          const result = await api.updateMap(map.id, { name: next });
          setMap(result.map);
        } catch {
          onToast(t("err.generic"));
        } finally {
          setSaving(false);
        }
      }, 700);
    },
    [canEdit, map.id, onToast, t],
  );

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const refreshMap = useCallback(async () => {
    try {
      const result = await api.map(map.id);
      setMap(result.map);
    } catch {
      /* la mappa resta quella in memoria: un refresh fallito non è bloccante */
    }
  }, [map.id]);

  // `others` arriva già raggruppato per persona e senza noi stessi: due schede
  // dello stesso collega sono un avatar solo, non due.
  const { people, others } = presence;
  // Un solo connesso non è "1 connessi": l'italiano richiede il singolare.
  const connectedLabel =
    people.length === 1 ? t("editor.connectedOne") : t("editor.connected", people.length);

  /**
   * Caricamento di un file GeoJSON come livello.
   *
   * Tre passaggi, in quest'ordine per una ragione: si valida **prima** di
   * caricare, così un file sbagliato non lascia rifiuti sul server; si carica
   * **prima** di iniettare, così il livello che finisce nel progetto ha già una
   * risorsa dietro; e si inietta per ultimo, quando non può più fallire a metà.
   */
  // Identità stabile: passata inline, cambierebbe a ogni render e farebbe
  // rieseguire l'effetto che registra il controllo dentro MapFrame.
  const onControl = useCallback((next: MapFrameControl | null) => {
    control.current = next;
  }, []);

  const onFileChosen = useCallback(
    async (file: File | undefined) => {
      if (!file || !canEdit) return;
      if (!control.current) {
        onToast(t("editor.notReady"));
        return;
      }

      setUploading(true);
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          onToast(t("err.bad-json"));
          return;
        }
        if (!isGeoJson(parsed)) {
          onToast(t("err.not-geojson"));
          return;
        }

        const geojson = parsed as GeoJson;
        const mode = pickMode({
          size: file.size,
          sestanteOrigin: window.location.origin,
          geolibreUrl: config.geolibreUrl,
        });
        if (mode === "too-large") {
          onToast(t("err.too-large-inline"));
          return;
        }

        const label = file.name.replace(/\.[^.]+$/, "") || file.name;
        const { file: stored } = await api.uploadMapFile(map.id, file.name, geojson);
        const layer = buildLayer({
          id: stored.id,
          name: label,
          geojson,
          url: mode === "url" ? stored.url : undefined,
        });

        if (!control.current?.addLayer(layer as unknown as Record<string, unknown>)) {
          onToast(t("editor.notReady"));
          return;
        }
        onToast(
          mode === "inline" ? t("editor.layerAddedInline", label) : t("editor.layerAdded", label),
        );
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "generic";
        const key = `err.${code}` as "err.generic";
        const message = t(key);
        onToast(message === key ? t("err.generic") : message);
      } finally {
        setUploading(false);
        // Senza questo, riscegliere lo stesso file non emette un `change` e il
        // secondo tentativo sembrerebbe ignorato.
        if (fileInput.current) fileInput.current.value = "";
      }
    },
    [canEdit, config.geolibreUrl, map.id, onToast, t],
  );

  return (
    <div className="editor">
      <header className="appbar">
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onBack}
          title={t("editor.back")}
        >
          <Icon name="back" size={15} />
        </button>
        <span className="brand-mark">
          <Icon name="globe" size={15} />
        </span>

        <div className="spacer" />

        <input
          className="proj-name"
          value={name}
          disabled={!canEdit}
          spellCheck={false}
          onChange={(event) => renameLater(event.target.value)}
        />
        <span className="saved hide-sm">
          {saving ? (
            t("editor.saving")
          ) : (
            <>
              <Icon name="check" size={13} />
              {t("editor.saved")}
            </>
          )}
        </span>

        <div className="spacer" />

        {/* Utenti connessi: gli avatar arrivano dal roster del relay GeoLibre,
            non da un elenco statico. Il bordo verde segnala la presenza viva. */}
        {others.length > 0 ? (
          <div className="stack hide-sm" title={connectedLabel}>
            {others.slice(0, 4).map((person) => (
              <Avatar
                key={person.key}
                name={person.displayName}
                color={person.color}
                live
                title={
                  person.displayName +
                  (person.verified ? "" : " (anonimo)") +
                  (person.connections > 1 ? ` — ${person.connections} schede` : "")
                }
              />
            ))}
            {others.length > 4 ? (
              <span className="avatar" style={{ background: "hsl(var(--muted-foreground))" }}>
                +{others.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}

        {canEdit ? (
          <>
            {/* Il selettore di file di GeoLibre non va usato: per i livelli che
                apre da lì, GeoLibre scarta la geometria quando ci trasmette il
                progetto, e alla riapertura la mappa è vuota. Questo invece
                passa da Sestante, che il file lo conserva. */}
            <input
              ref={fileInput}
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              style={{ display: "none" }}
              onChange={(event) => void onFileChosen(event.target.files?.[0])}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={uploading}
              title={t("editor.addDataHint")}
              onClick={() => fileInput.current?.click()}
            >
              <Icon name="plus" size={14} />
              <span className="hide-sm">
                {uploading ? t("editor.uploading") : t("editor.addData")}
              </span>
            </button>
          </>
        ) : null}

        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShareOpen(true)}>
          <Icon name="share" size={14} />
          <span>{t("editor.share")}</span>
        </button>
        <LanguageButton />
        <ThemeButton />
        <UserButton user={user} onLogout={onLogout} />
      </header>

      {/* Il progetto si passa solo quando è stato caricato: `undefined` significa
          "non ancora noto", `null` "mappa vuota". */}
      {/* Con la collaborazione nella mappa si aspetta anche il biglietto della
          sessione: montare prima vorrebbe dire caricare GeoLibre due volte. */}
      {project !== undefined && presence.inMapSession !== undefined ? (
        <MapFrame
          baseUrl={config.geolibreUrl}
          readOnly={!canEdit}
          collabSession={presence.inMapSession}
          initialProject={project}
          onProjectChange={persistProject}
          onControl={onControl}
        />
      ) : (
        <div className="map-host">
          <div className="map-overlay">{t("editor.loading")}</div>
        </div>
      )}

      <footer className="statusbar">
        <span className="sb-item">
          <span className={`dot ${presence.status === "live" ? "dot-ok" : "dot-off"}`} />
          {presence.status === "live"
            ? t("editor.session")
            : presence.status === "error"
              ? t("editor.relayDown")
              : presence.status === "connecting"
                ? t("dash.loading")
                : t("editor.sessionOff")}
        </span>
        {presence.status === "live" ? (
          <span className="sb-item">
            {/* La stringa tradotta porta già il numero: non va ripetuto accanto. */}
            <b className="mono">{connectedLabel}</b>
          </span>
        ) : null}
        <span className="sb-item">
          {t(`role.${map.role}` as "role.owner")}
          {!canEdit ? <b>· {t("editor.readonly")}</b> : null}
        </span>
        <span className="sb-item hide-sm">
          <b className="mono">{relative(map.updatedAt)}</b>
        </span>
        <div className="spacer" />
        <span className="sb-item mono hide-sm">{map.id.slice(0, 8)}</span>
      </footer>

      {shareOpen ? (
        <ShareDialog
          map={map}
          orgLabel={config.orgLabel}
          orgDomain={config.orgDomain}
          onClose={() => setShareOpen(false)}
          onToast={onToast}
          onChanged={() => {
            void refreshMap();
            // Un cambio di permessi può aver sostituito la sessione.
            presence.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
