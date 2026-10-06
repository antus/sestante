/**
 * Lettura dei campi di una richiesta. Il corpo JSON e la query arrivano da
 * fuori: un campo atteso come testo può essere un oggetto, un numero o una
 * lista (`?q=a&q=b`). Ciò che non è testo vale come assente, così diventa una
 * richiesta sbagliata (400) e non un errore del server (500).
 */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
