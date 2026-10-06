/**
 * Localizzazione IT/EN.
 *
 * La lingua non è solo una tabella di stringhe: è anche il locale con cui si
 * formattano date e numeri, l'attributo `lang` del documento, e — il punto che
 * conta qui — il parametro che viene passato all'istanza GeoLibre incorporata.
 * Vedi MapFrame: cambiare lingua qui rimonta l'iframe con `lang` aggiornato,
 * perché il protocollo embed v2 non espone alcun comando per cambiarla a caldo.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { loadPrefs, savePrefs } from "./prefs";

export type Locale = "it" | "en";

const DICT = {
  it: {
    "app.tagline": "Piattaforma geospaziale",
    "login.claim": "Le tue mappe, il tuo team, i tuoi dati.",
    "login.claimSub":
      "Crea mappe con il motore GeoLibre, condividile in sola lettura o in scrittura, e lavoraci insieme in tempo reale.",
    "login.title": "Accedi al tuo spazio",
    "login.sub": "Usa le credenziali aziendali o l'accesso con email.",
    "login.tenant": "Organizzazione",
    "login.sso": "Continua con SSO aziendale",
    "login.or": "oppure",
    "login.email": "Email",
    "login.pass": "Password",
    "login.name": "Nome e cognome",
    "login.submit": "Accedi",
    "login.signup": "Crea un account",
    "login.toSignup": "Non hai un account? Registrati",
    "login.toLogin": "Hai già un account? Accedi",
    "login.working": "Attendere…",
    "err.invalid-credentials": "Email o password non corretti.",
    "err.too-many-attempts": "Troppi tentativi. Riprova fra qualche minuto.",
    "err.missing-credentials": "Inserisci email e password.",
    "err.invalid-email": "Indirizzo email non valido.",
    "err.too-short": "La password deve avere almeno 10 caratteri.",
    "err.too-simple": "La password deve contenere lettere e numeri.",
    "err.email-taken": "Esiste già un account con questa email.",
    "err.signup-disabled": "La registrazione autonoma è disattivata.",
    "err.network": "Server non raggiungibile.",
    "err.generic": "Operazione non riuscita.",
    "err.project-too-large":
      "La mappa è troppo grande per essere salvata: contiene dati incorporati oltre il limite. Carica quei livelli da un URL invece che da file locale.",
    "err.read-only": "Hai accesso in sola lettura a questa mappa.",
    "err.not-geojson": "Il file non è un GeoJSON valido.",
    "err.file-too-large": "Il file supera il limite di caricamento.",
    "err.file-missing": "Il file risulta registrato ma non è più nell'archivio.",
    "err.bad-json": "Il file non contiene JSON leggibile.",
    "err.too-large-inline":
      "File troppo grande da incorporare nella mappa. Serve un'istanza GeoLibre servita sullo stesso schema di Sestante.",
    "auth.discovery": "Configurazione Keycloak non raggiungibile.",
    "auth.exchange": "Accesso SSO non riuscito.",
    "auth.missing_code": "Risposta SSO incompleta.",

    "nav.mine": "Le mie mappe",
    "nav.shared": "Condivise con me",
    "nav.recent": "Recenti",
    "nav.fav": "Preferiti",
    "nav.trash": "Cestino",
    "dash.search": "Cerca mappe, descrizioni, persone…",
    "dash.new": "Nuova mappa",
    "dash.newName": "Mappa senza titolo",
    "dash.countMine": "{n} mappe di cui sei proprietario",
    "dash.countShared": "{n} mappe condivise con te",
    "dash.countRecent": "Aperte di recente",
    "dash.countFav": "Le mappe che hai contrassegnato",
    "dash.countTrash": "Elementi eliminati negli ultimi 30 giorni",
    "dash.empty": "Nessuna mappa qui.",
    "card.actions": "Altre azioni",
    "card.delete": "Elimina mappa",
    "confirm.deleteTitle": "Eliminare «{n}»?",
    "confirm.deleteBody":
      "La mappa, le sue condivisioni e i suoi link d'invito vengono eliminati definitivamente. L'operazione non è reversibile.",
    "common.delete": "Elimina",
    "toast.deleted": "Mappa eliminata",
    "dash.quota": "Spazio utilizzato",
    "dash.loading": "Caricamento…",

    "role.owner": "Proprietario",
    "role.editor": "Può modificare",
    "role.viewer": "Sola lettura",
    "role.editorLong": "Può modificare",
    "role.viewerLong": "Può visualizzare",
    "vis.private": "Privata",
    "vis.org": "Organizzazione",
    "vis.link": "Link pubblico",

    "editor.back": "Torna alle mappe",
    "editor.share": "Condividi",
    "editor.saved": "Salvato",
    "editor.saving": "Salvataggio…",
    "editor.readonly": "Sola lettura",
    "editor.loading": "Apertura della mappa…",
    "editor.noEmbed":
      "L'istanza GeoLibre non è configurata. Imposta GEOLIBRE_URL nel file .env.",
    "editor.noApi": "API runtime non disponibile",
    "editor.noApiHint":
      "L'istanza GeoLibre non ha questa origine in allowlist: la mappa si vede ma non riceve comandi. Avviala con GEOLIBRE_EMBED_ORIGINS.",
    "editor.session": "Sessione collaborativa",
    "editor.sessionOff": "Collaborazione non attiva",
    "editor.connected": "{n} connessi",
    "editor.connectedOne": "1 connesso",
    "editor.relayDown": "Relay non raggiungibile",
    "editor.addData": "Aggiungi dati",
    "editor.addDataHint": "Carica un file GeoJSON come livello della mappa",
    "editor.uploading": "Caricamento…",
    "editor.layerAdded": "Livello «{n}» aggiunto e salvato.",
    "editor.layerAddedInline":
      "Livello «{n}» aggiunto. I dati sono salvati dentro la mappa perché GeoLibre è servita in https e Sestante in http.",
    "editor.notReady": "La mappa non ha ancora finito di aprirsi. Riprova fra un istante.",

    "share.title": "Condividi «{n}»",
    "share.sub":
      "Le persone invitate vedono la mappa con la lingua e il tema del proprio account.",
    "share.invite": "Invita per email",
    "share.send": "Invita",
    "share.people": "Persone con accesso",
    "share.general": "Accesso generale",
    "share.private": "Solo le persone invitate",
    "share.org": "Tutti in {n}",
    "share.link": "Chiunque abbia il link",
    "share.copy": "Copia",
    "share.remove": "Rimuovi",
    "share.you": "tu",
    "share.readonlyNote": "Solo il proprietario può modificare gli accessi.",

    "theme.title": "Tema",
    "theme.mode": "Modalità",
    "theme.light": "Chiaro",
    "theme.dark": "Scuro",
    "theme.system": "Sistema",
    "theme.scheme": "Colore principale",
    "scheme.blue": "Blu",
    "scheme.violet": "Viola",
    "scheme.emerald": "Smeraldo",
    "scheme.rose": "Rosa",
    "scheme.amber": "Ambra",
    "lang.title": "Lingua",
    "lang.it": "Italiano",
    "lang.en": "Inglese",
    "lang.note": "La mappa viene ricaricata nella nuova lingua.",

    "user.settings": "Impostazioni",
    "user.logout": "Esci",
    "common.close": "Chiudi",
    "common.done": "Fine",
    "common.cancel": "Annulla",
    "toast.copied": "Link copiato negli appunti",
    "toast.invited": "Invito inviato a {n}",
    "toast.roleChanged": "Ruolo aggiornato",
    "toast.removed": "Accesso revocato",
    "toast.created": "Mappa creata",
    "toast.readonly": "Hai accesso in sola lettura a questa mappa",
    "time.now": "adesso",
    "time.min": "{n} min fa",
    "time.hour": "{n} ore fa",
    "time.day": "{n} giorni fa",
  },
  en: {
    "app.tagline": "Geospatial platform",
    "login.claim": "Your maps, your team, your data.",
    "login.claimSub":
      "Build maps on the GeoLibre engine, share them read-only or read-write, and work on them together in real time.",
    "login.title": "Sign in to your workspace",
    "login.sub": "Use your corporate credentials or sign in with email.",
    "login.tenant": "Organisation",
    "login.sso": "Continue with corporate SSO",
    "login.or": "or",
    "login.email": "Email",
    "login.pass": "Password",
    "login.name": "Full name",
    "login.submit": "Sign in",
    "login.signup": "Create an account",
    "login.toSignup": "No account yet? Sign up",
    "login.toLogin": "Already have an account? Sign in",
    "login.working": "Please wait…",
    "err.invalid-credentials": "Wrong email or password.",
    "err.too-many-attempts": "Too many attempts. Try again in a few minutes.",
    "err.missing-credentials": "Enter an email and a password.",
    "err.invalid-email": "That email address is not valid.",
    "err.too-short": "The password must be at least 10 characters.",
    "err.too-simple": "The password must contain letters and digits.",
    "err.email-taken": "An account with this email already exists.",
    "err.signup-disabled": "Self sign-up is disabled.",
    "err.network": "Server unreachable.",
    "err.generic": "That did not work.",
    "err.project-too-large":
      "This map is too large to save: it embeds data beyond the limit. Load those layers from a URL rather than a local file.",
    "err.read-only": "You have read-only access to this map.",
    "err.not-geojson": "That file is not valid GeoJSON.",
    "err.file-too-large": "The file is over the upload limit.",
    "err.file-missing": "The file is on record but no longer in storage.",
    "err.bad-json": "The file does not contain readable JSON.",
    "err.too-large-inline":
      "Too large to embed in the map. This needs a GeoLibre instance served over the same scheme as Sestante.",
    "auth.discovery": "Keycloak configuration unreachable.",
    "auth.exchange": "SSO sign-in failed.",
    "auth.missing_code": "Incomplete SSO response.",

    "nav.mine": "My maps",
    "nav.shared": "Shared with me",
    "nav.recent": "Recent",
    "nav.fav": "Favourites",
    "nav.trash": "Trash",
    "dash.search": "Search maps, descriptions, people…",
    "dash.new": "New map",
    "dash.newName": "Untitled map",
    "dash.countMine": "{n} maps you own",
    "dash.countShared": "{n} maps shared with you",
    "dash.countRecent": "Recently opened",
    "dash.countFav": "Maps you starred",
    "dash.countTrash": "Items deleted in the last 30 days",
    "dash.empty": "No maps here.",
    "card.actions": "More actions",
    "card.delete": "Delete map",
    "confirm.deleteTitle": "Delete “{n}”?",
    "confirm.deleteBody":
      "The map, its shares and its invite links are deleted permanently. This cannot be undone.",
    "common.delete": "Delete",
    "toast.deleted": "Map deleted",
    "dash.quota": "Storage used",
    "dash.loading": "Loading…",

    "role.owner": "Owner",
    "role.editor": "Can edit",
    "role.viewer": "Read-only",
    "role.editorLong": "Can edit",
    "role.viewerLong": "Can view",
    "vis.private": "Private",
    "vis.org": "Organisation",
    "vis.link": "Public link",

    "editor.back": "Back to maps",
    "editor.share": "Share",
    "editor.saved": "Saved",
    "editor.saving": "Saving…",
    "editor.readonly": "Read-only",
    "editor.loading": "Opening the map…",
    "editor.noEmbed": "No GeoLibre instance configured. Set GEOLIBRE_URL in the .env file.",
    "editor.noApi": "Runtime API unavailable",
    "editor.noApiHint":
      "This GeoLibre instance does not allowlist this origin: the map renders but ignores commands. Start it with GEOLIBRE_EMBED_ORIGINS.",
    "editor.session": "Collaborative session",
    "editor.sessionOff": "Collaboration off",
    "editor.connected": "{n} connected",
    "editor.connectedOne": "1 connected",
    "editor.relayDown": "Relay unreachable",
    "editor.addData": "Add data",
    "editor.addDataHint": "Upload a GeoJSON file as a map layer",
    "editor.uploading": "Uploading…",
    "editor.layerAdded": "Layer \u201c{n}\u201d added and saved.",
    "editor.layerAddedInline":
      "Layer \u201c{n}\u201d added. Its data is stored inside the map because GeoLibre is served over https and Sestante over http.",
    "editor.notReady": "The map has not finished opening yet. Try again in a moment.",

    "share.title": "Share “{n}”",
    "share.sub": "Invited people see the map in their own account language and theme.",
    "share.invite": "Invite by email",
    "share.send": "Invite",
    "share.people": "People with access",
    "share.general": "General access",
    "share.private": "Only invited people",
    "share.org": "Everyone at {n}",
    "share.link": "Anyone with the link",
    "share.copy": "Copy",
    "share.remove": "Remove",
    "share.you": "you",
    "share.readonlyNote": "Only the owner can change access.",

    "theme.title": "Theme",
    "theme.mode": "Mode",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.system": "System",
    "theme.scheme": "Accent colour",
    "scheme.blue": "Blue",
    "scheme.violet": "Violet",
    "scheme.emerald": "Emerald",
    "scheme.rose": "Rose",
    "scheme.amber": "Amber",
    "lang.title": "Language",
    "lang.it": "Italian",
    "lang.en": "English",
    "lang.note": "The map reloads in the new language.",

    "user.settings": "Settings",
    "user.logout": "Sign out",
    "common.close": "Close",
    "common.done": "Done",
    "common.cancel": "Cancel",
    "toast.copied": "Link copied to clipboard",
    "toast.invited": "Invitation sent to {n}",
    "toast.roleChanged": "Role updated",
    "toast.removed": "Access revoked",
    "toast.created": "Map created",
    "toast.readonly": "You have read-only access to this map",
    "time.now": "just now",
    "time.min": "{n} min ago",
    "time.hour": "{n} hours ago",
    "time.day": "{n} days ago",
  },
} as const;

export type MessageKey = keyof (typeof DICT)["it"];

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, value?: string | number) => string;
  formatDate: (epochMs: number) => string;
  relative: (epochMs: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => loadPrefs().locale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    savePrefs({ locale: next });
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nValue>(() => {
    const tag = locale === "it" ? "it-IT" : "en-GB";
    const table = DICT[locale] as Record<string, string>;
    return {
      locale,
      setLocale,
      t: (key, value) => {
        const raw = table[key] ?? (DICT.it as Record<string, string>)[key] ?? key;
        return value === undefined ? raw : raw.replace("{n}", String(value));
      },
      formatDate: (epochMs) =>
        new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(epochMs),
      relative: (epochMs) => {
        const table2 = DICT[locale] as Record<string, string>;
        const diff = Math.max(0, Date.now() - epochMs);
        const minutes = Math.round(diff / 60_000);
        if (minutes < 1) return table2["time.now"] as string;
        if (minutes < 60) return (table2["time.min"] as string).replace("{n}", String(minutes));
        const hours = Math.round(minutes / 60);
        if (hours < 24) return (table2["time.hour"] as string).replace("{n}", String(hours));
        return (table2["time.day"] as string).replace("{n}", String(Math.round(hours / 24)));
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n va usato dentro <I18nProvider>");
  return value;
}
