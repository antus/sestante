/**
 * Client HTTP verso il server Sestante.
 *
 * Tutte le chiamate viaggiano con `credentials: "same-origin"`: la sessione è
 * un cookie HttpOnly, quindi il token non è mai leggibile da JavaScript e non
 * c'è nulla da mettere in un header Authorization. È anche il motivo per cui in
 * sviluppo Vite fa da proxy su /api invece di puntare a un'altra porta.
 *
 * Gli errori arrivano come `ApiError` con il codice applicativo del server
 * (`invalid-credentials`, `owner-only`, …): l'interfaccia lo traduce con la
 * tabella i18n invece di mostrare messaggi del server all'utente finale.
 */
import { appPath } from "./base";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  provider: string;
  color: string;
  locale: string;
  theme: string;
  accent: string;
}

export type Role = "owner" | "editor" | "viewer";
export type GeneralAccess = "private" | "org" | "link";

export interface MapSummary {
  id: string;
  name: string;
  description: string;
  thumb: string;
  role: Role;
  generalAccess: GeneralAccess;
  generalRole: Exclude<Role, "owner">;
  updatedAt: number;
  owner: { id: string; displayName: string; color: string };
  collaborators: { id: string; displayName: string; color: string; role: string }[];
  liveSession: boolean;
}

export interface ServerConfig {
  keycloakEnabled: boolean;
  allowLocalSignup: boolean;
  orgLabel: string;
  orgDomain: string;
  geolibreUrl: string;
}

export interface SharePerson {
  shareId: string;
  role: Exclude<Role, "owner">;
  user: PublicUser;
}

export interface ShareState {
  owner: PublicUser | null;
  people: SharePerson[];
  generalAccess: GeneralAccess;
  generalRole: Exclude<Role, "owner">;
  shareUrl: string;
  invites: { token: string; role: string; uses: number; maxUses: number | null; url: string }[];
  canManage: boolean;
}

export interface MapFile {
  id: string;
  name: string;
  size: number;
  /** URL assoluto, con il segreto di lettura: è ciò che segue l'iframe GeoLibre. */
  url: string;
}

export interface CollabTicket {
  sessionId: string;
  wsUrl: string;
  hostToken: string | null;
  /** Invito co-edit: solo agli editor che non sono il proprietario. */
  inviteToken: string | null;
  canEdit: boolean;
  /** La collaborazione avviene dentro GeoLibre, non con una connessione di Sestante. */
  inMap: boolean;
  identityToken: string;
  displayName: string;
  color: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    // Sotto la base dell'app: "/api/…" diventa "/sestante/api/…" se serve.
    response = await fetch(appPath(path), {
      ...init,
      credentials: "same-origin",
      headers:
        init.body === undefined
          ? { accept: "application/json", ...(init.headers ?? {}) }
          : { "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "network");
  }

  if (response.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const code =
      body && typeof body === "object" && typeof (body as { error?: string }).error === "string"
        ? (body as { error: string }).error
        : "generic";
    throw new ApiError(response.status, code);
  }
  return body as T;
}

const json = (value: unknown) => JSON.stringify(value);

export const api = {
  config: () => request<ServerConfig>("/api/config"),

  me: () => request<{ user: PublicUser }>("/api/me"),

  login: (email: string, password: string) =>
    request<{ user: PublicUser }>("/api/auth/login", {
      method: "POST",
      body: json({ email, password }),
    }),

  register: (email: string, password: string, displayName: string) =>
    request<{ user: PublicUser }>("/api/auth/register", {
      method: "POST",
      body: json({ email, password, displayName }),
    }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  maps: (scope: "all" | "mine" | "shared" = "all") =>
    request<{ items: MapSummary[]; counts: { mine: number; shared: number } }>(
      `/api/maps?scope=${scope}`,
    ),

  map: (id: string) =>
    request<{ map: MapSummary; project: unknown; role: Role }>(`/api/maps/${id}`),

  createMap: (name: string, description = "", thumb = "italia") =>
    request<{ map: MapSummary }>("/api/maps", {
      method: "POST",
      body: json({ name, description, thumb }),
    }),

  /**
   * `keepalive` serve al salvataggio dell'ultimo istante: una richiesta marcata
   * così viene portata a termine dal browser anche se la pagina cambia o il
   * componente viene smontato. Senza, chiudere la mappa subito dopo una
   * modifica la perde.
   */
  updateMap: (
    id: string,
    patch: { name?: string; description?: string; project?: unknown },
    options: { keepalive?: boolean } = {},
  ) =>
    request<{ map: MapSummary }>(`/api/maps/${id}`, {
      method: "PATCH",
      body: json(patch),
      ...(options.keepalive ? { keepalive: true } : {}),
    }),

  deleteMap: (id: string) => request<{ ok: true }>(`/api/maps/${id}`, { method: "DELETE" }),

  setAccess: (id: string, generalAccess: GeneralAccess, generalRole: Exclude<Role, "owner">) =>
    request<{ map: MapSummary }>(`/api/maps/${id}/access`, {
      method: "PATCH",
      body: json({ generalAccess, generalRole }),
    }),

  shares: (id: string) => request<ShareState>(`/api/maps/${id}/shares`),

  invite: (id: string, email: string, role: Exclude<Role, "owner">) =>
    request<{ user: PublicUser; role: string }>(`/api/maps/${id}/shares`, {
      method: "POST",
      body: json({ email, role }),
    }),

  setShareRole: (id: string, shareId: string, role: Exclude<Role, "owner">) =>
    request<{ ok: true }>(`/api/maps/${id}/shares/${shareId}`, {
      method: "PATCH",
      body: json({ role }),
    }),

  removeShare: (id: string, shareId: string) =>
    request<{ ok: true }>(`/api/maps/${id}/shares/${shareId}`, { method: "DELETE" }),

  mapFiles: (id: string) => request<{ items: MapFile[] }>(`/api/maps/${id}/files`),

  /**
   * Carica un GeoJSON come risorsa della mappa. Si invia il documento già
   * decodificato invece di un multipart: è JSON in partenza, e il server lo
   * riserializza da ciò che ha accettato, così su disco finisce solo roba
   * valida.
   */
  uploadMapFile: (id: string, name: string, geojson: unknown) =>
    request<{ file: MapFile }>(`/api/maps/${id}/files`, {
      method: "POST",
      body: json({ name, geojson }),
    }),

  deleteMapFile: (id: string, fileId: string) =>
    request<{ ok: true }>(`/api/maps/${id}/files/${fileId}`, { method: "DELETE" }),

  collabStatus: () =>
    request<{ enabled: boolean; reachable: boolean; identitySupported?: boolean }>(
      "/api/collab/status",
    ),

  /** `verify`: il relay ha rifiutato la sessione, il server la controlli o la ricrei. */
  openCollabSession: (id: string, verify = false) =>
    request<CollabTicket>(`/api/maps/${id}/collab/session`, {
      method: "POST",
      body: json({ verify }),
    }),

  refreshCollabIdentity: () =>
    request<{ identityToken: string; expiresIn: number }>("/api/collab/identity-token", {
      method: "POST",
      body: json({}),
    }),

  /**
   * Dimentica la sessione registrata sulla mappa, così la prossima
   * `openCollabSession` ne crea una nuova. Serve quando il relay è ripartito
   * con un archivio vuoto, o la sessione è scaduta per inattività: il codice
   * memorizzato punta a qualcosa che non esiste più. Solo il proprietario.
   */
  resetCollabSession: (id: string) =>
    request<{ ok: true }>(`/api/maps/${id}/collab/session`, { method: "DELETE" }),
};
