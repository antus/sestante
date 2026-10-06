/**
 * Controllo preliminare della versione di Node.
 *
 * Esiste perché il fallimento vero è illeggibile: su Node 20 il progetto muore
 * con `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite`, che
 * non dice a nessuno qual è il problema né come si risolve. Meglio fermarsi
 * prima, con un messaggio che lo dice.
 *
 * La soglia non è un capriccio: `node:sqlite` (la persistenza, senza
 * dipendenze native da compilare) è disponibile da Node 22.5 ed è dichiarato
 * stabile da 22.13; Vite 7 e @vitejs/plugin-react richiedono a loro volta
 * >=20.19 o >=22.12. Node 22 LTS li soddisfa tutti.
 */
const MINIMUM = [22, 13, 0];

const current = process.versions.node.split(".").map(Number);
const ok =
  current[0] > MINIMUM[0] ||
  (current[0] === MINIMUM[0] &&
    (current[1] > MINIMUM[1] || (current[1] === MINIMUM[1] && current[2] >= MINIMUM[2])));

if (ok) process.exit(0);

const box = (lines) => {
  const width = Math.max(...lines.map((line) => line.length));
  const bar = "─".repeat(width + 2);
  return [
    `┌${bar}┐`,
    ...lines.map((line) => `│ ${line.padEnd(width)} │`),
    `└${bar}┘`,
  ].join("\n");
};

console.error(
  "\n" +
    box([
      "Sestante richiede Node 22.13 o superiore.",
      `Versione in uso: ${process.versions.node}`,
      "",
      "Perché: la persistenza usa node:sqlite, il modulo SQLite",
      "integrato in Node (niente dipendenze native da compilare).",
      "È disponibile da Node 22.5. Anche Vite 7 richiede almeno",
      "Node 20.19.",
      "",
      "Come aggiornare, una delle due:",
      "",
      "  winget install OpenJS.NodeJS.LTS",
      "  https://nodejs.org/en/download  (installer LTS)",
      "",
      "Se hai nvm-windows:",
      "",
      "  nvm install 22.13.0 && nvm use 22.13.0",
      "",
      "Poi ripeti:  npm run setup",
      "",
      "Se non puoi aggiornare Node su questa postazione, dimmelo:",
      "esiste una variante con SQLite in WebAssembly che gira",
      "anche su Node 20, senza build tools.",
    ]) +
    "\n",
);
process.exit(1);
