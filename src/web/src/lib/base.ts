/**
 * Il percorso sotto cui è pubblicata l'app: "/" oppure, ad esempio, "/sestante/".
 *
 * Lo decide il server, che lo scrive nella pagina come `<base href>` (vedi
 * src/server/src/web-static.ts). In sviluppo (Vite) il tag non c'è e vale "/".
 */
export const APP_BASE = (() => {
  const href = document.querySelector("base")?.getAttribute("href") ?? "/";
  return href.endsWith("/") ? href : `${href}/`;
})();

/** Un percorso dell'app ("/m/x", "api/…") come indirizzo assoluto sotto la base. */
export function appPath(path: string): string {
  return `${APP_BASE}${path.replace(/^\/+/, "")}`;
}

/** Il percorso della pagina corrente, senza la base: "/m/x". */
export function currentRoute(): string {
  const path = window.location.pathname;
  return path.startsWith(APP_BASE) ? `/${path.slice(APP_BASE.length)}` : path;
}
