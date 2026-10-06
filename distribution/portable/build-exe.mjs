/**
 * Sestante.exe + cartella geolibre/, in uno zip portabile.
 *
 * L'eseguibile è una Node single executable application: una copia del
 * node.exe con cui si lancia questo script, con dentro il server (un unico
 * bundle CommonJS) e il client React come asset. GeoLibre resta fuori, in
 * geolibre/ accanto all'eseguibile, così si aggiorna sostituendo la cartella
 * senza ricompilare Sestante.
 *
 *   node distribution/portable/build-exe.mjs              compila il client e produce lo zip
 *   node distribution/portable/build-exe.mjs --skip-web   riusa src/web/dist
 *   node distribution/portable/build-exe.mjs --no-zip     lascia solo la cartella .out/release/Sestante
 *
 * Prerequisito: .out/geolibre/web (npm run build:geolibre).
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const isWindows = process.platform === "win32";
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const work = join(root, ".out/release/.build");
const out = join(root, ".out/release/Sestante");
const exeName = isWindows ? "Sestante.exe" : "sestante";
const geolibreDist = join(root, ".out/geolibre/web");
const webDist = join(root, "src/web/dist");

function step(message) {
  console.log(`\n  ▸ ${message}`);
}
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    console.error(`\n  Comando fallito: ${command} ${commandArgs.join(" ")}\n`);
    process.exit(result.status ?? 1);
  }
}
function filesUnder(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

if (!existsSync(join(geolibreDist, "index.html"))) {
  console.error("\n  Manca .out/geolibre/web: esegui prima  npm run build:geolibre\n");
  process.exit(1);
}

// ── 1. Client React ─────────────────────────────────────────────────────────
if (!args.includes("--skip-web")) {
  step("Compilo il client React");
  run(isWindows ? "npm.cmd" : "npm", ["run", "build", "-w", "@sestante/web"], { cwd: root, shell: isWindows });
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// ── 2. Server in un solo file CommonJS ──────────────────────────────────────
// CommonJS perché è il formato che una SEA esegue su tutte le versioni di Node
// supportate. `import.meta` nel bundle resta vuoto: paths.ts non lo legge
// quando gira dentro l'eseguibile.
step("Raccolgo il server in un unico bundle");
await build({
  entryPoints: [join(root, "src/server/src/index.ts")],
  outfile: join(work, "server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  minify: false,
  legalComments: "none",
  logOverride: { "empty-import-meta": "silent" },
  // Facoltativi per pg, che li cerca solo se richiesti esplicitamente.
  external: ["pg-native", "cloudflare:sockets"],
});

// ── 3. Asset: il client React ───────────────────────────────────────────────
const webFiles = filesUnder(webDist)
  .map((path) => relative(webDist, path).replace(/\\/g, "/"))
  .filter((path) => !path.endsWith(".map"));
const assets = Object.fromEntries(webFiles.map((path) => [`web/${path}`, join(webDist, path)]));
writeFileSync(join(work, "web-manifest.json"), JSON.stringify(webFiles));
assets["web/manifest.json"] = join(work, "web-manifest.json");

// ── 4. Blob SEA e iniezione nell'eseguibile ─────────────────────────────────
step(`Preparo l'eseguibile da Node ${process.version}`);
writeFileSync(
  join(work, "sea-config.json"),
  JSON.stringify(
    {
      main: join(work, "server.cjs"),
      output: join(work, "sea-prep.blob"),
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets,
    },
    null,
    2,
  ),
);
run(process.execPath, ["--experimental-sea-config", join(work, "sea-config.json")], { cwd: work });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const exe = join(out, exeName);
copyFileSync(process.execPath, exe);
run(
  process.execPath,
  [
    join(root, "node_modules/postject/dist/cli.js"),
    exe,
    "NODE_SEA_BLOB",
    join(work, "sea-prep.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { cwd: work },
);

// ── 5. GeoLibre e file di accompagnamento ───────────────────────────────────
step("Copio GeoLibre accanto all'eseguibile");
cpSync(geolibreDist, join(out, "geolibre"), { recursive: true });
const geolibreManifest = join(root, ".out/geolibre/manifest.json");
if (existsSync(geolibreManifest)) copyFileSync(geolibreManifest, join(out, "geolibre/sestante-build.json"));
// Servizio Windows: WinSW (versione e impronta fissate) più configurazione e
// script di distribution/windows-service. WinSW si scarica una volta e resta in .out/cache.
if (isWindows) {
  step("Preparo il servizio Windows (WinSW)");
  const winsw = {
    version: "2.12.0",
    asset: "WinSW.NET461.exe",
    sha256: "b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f",
  };
  const cached = join(root, `.out/cache/winsw/${winsw.version}/${winsw.asset}`);
  if (!existsSync(cached)) {
    mkdirSync(dirname(cached), { recursive: true });
    const url = `https://github.com/winsw/winsw/releases/download/v${winsw.version}/${winsw.asset}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download di WinSW non riuscito: ${response.status} ${url}`);
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  }
  const digest = createHash("sha256").update(readFileSync(cached)).digest("hex");
  if (digest !== winsw.sha256) {
    rmSync(cached, { force: true });
    throw new Error(`WinSW con impronta inattesa (${digest}): file scartato, riprova.`);
  }
  const service = join(out, "service");
  mkdirSync(service, { recursive: true });
  copyFileSync(cached, join(service, "sestante-service.exe"));
  const packaging = join(root, "distribution/windows-service");
  for (const file of readdirSync(packaging)) {
    const text = readFileSync(join(packaging, file), "utf8").replace(/\r?\n/g, "\r\n");
    // PowerShell 5.1 legge senza BOM con la codifica locale: le lettere
    // accentate dei messaggi uscirebbero storpiate.
    writeFileSync(join(service, file), (file.endsWith(".ps1") ? "﻿" : "") + text);
  }
}

// Il relay sta fuori da geolibre/, che è servita così com'è sotto /gis/.
const relayBundle = join(root, ".out/geolibre/relay/relay.cjs");
if (existsSync(relayBundle)) {
  mkdirSync(join(out, "relay"), { recursive: true });
  copyFileSync(relayBundle, join(out, "relay/relay.cjs"));
} else {
  console.warn("  (relay non trovato: la collaborazione non sarà disponibile nell'eseguibile)");
}

writeFileSync(
  join(out, "sestante.env.example"),
  [
    "# Configurazione facoltativa di Sestante.exe.",
    "# Rinomina questo file in sestante.env e togli il # dalle righe che ti servono.",
    "",
    "# Porta d'ascolto (se occupata, l'eseguibile prova le successive).",
    "# PORT=4000",
    "",
    "# Cartella dei dati. Di default: data\\ accanto all'eseguibile, oppure",
    "# %LOCALAPPDATA%\\Sestante se questa cartella non è scrivibile.",
    "# DATA_DIR=",
    "",
    "# Accesso con Keycloak (vuoto = solo accesso locale).",
    "# KEYCLOAK_ISSUER=https://sso.example.org/realms/sestante",
    "# KEYCLOAK_CLIENT_ID=sestante",
    "# KEYCLOAK_CLIENT_SECRET=",
    "# KEYCLOAK_REDIRECT_URI=http://localhost:4000/api/auth/keycloak/callback",
    "",
    "# Collaborazione: presenza e sessioni condivise, con il relay di GeoLibre",
    "# ospitato da Sestante stesso (nessun programma in più da avviare).",
    "# COLLAB_EMBEDDED=1",
    "# COLLAB_URL=http://127.0.0.1:8787",
    "",
    "# Utente creato al primo avvio (database vuoto). Default:",
    "# admin@example.org / sestante2026",
    "# DEFAULT_USER_EMAIL=admin@example.org",
    "# DEFAULT_USER_PASSWORD=",
    "",
    "# Non aprire il browser all'avvio.",
    "# SESTANTE_NO_BROWSER=1",
    "",
  ].join("\r\n"),
);
writeFileSync(
  join(out, "LEGGIMI.txt"),
  [
    `Sestante ${version}`,
    "",
    "Avvio: doppio clic su Sestante.exe. Si apre il browser su http://localhost:4000",
    "(o sulla prima porta libera successiva). Chiudi la finestra nera per fermarlo.",
    "",
    "Al primo avvio c'è già un utente:  admin@example.org  /  sestante2026",
    "(cambiabili in sestante.env con DEFAULT_USER_EMAIL e DEFAULT_USER_PASSWORD,",
    "prima del primo avvio). Puoi anche registrare altri account dalla pagina",
    "di accesso.",
    "",
    "I dati (database, file caricati) sono in data\\ accanto all'eseguibile:",
    "per un backup basta copiare quella cartella.",
    "",
    "La cartella geolibre\\ contiene il motore cartografico e va lasciata accanto",
    "a Sestante.exe, come la cartella relay\\ (collaborazione, se attivata).",
    "Configurazione facoltativa: vedi sestante.env.example.",
    "",
    "Come servizio Windows (avvio automatico, senza finestra), da un PowerShell",
    "aperto come amministratore, nella cartella service\\:",
    "",
    "  powershell -ExecutionPolicy Bypass -File .\\install-service.ps1",
    "",
    "Copia Sestante in C:\\Program Files\\Sestante, tiene i dati in",
    "C:\\ProgramData\\Sestante e lo avvia su http://localhost:4000 (-Port per",
    "cambiarla). Per toglierlo: uninstall-service.ps1.",
    "",
  ].join("\r\n"),
);
rmSync(work, { recursive: true, force: true });

// ── 6. Zip ──────────────────────────────────────────────────────────────────
const size = (path) => filesUnder(path).reduce((sum, file) => sum + statSync(file).size, 0);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`\n  ${exeName.padEnd(14)} ${mb(statSync(exe).size)}`);
console.log(`  geolibre/      ${mb(size(join(out, "geolibre")))}`);

if (!args.includes("--no-zip")) {
  const zip = join(root, `.out/release/Sestante-${version}-${process.platform}-${process.arch}.zip`);
  rmSync(zip, { force: true });
  step("Creo lo zip");
  // Il tar di Windows (bsdtar, in System32) sa scrivere zip; quello di Git Bash no.
  const tar = isWindows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "zip";
  if (isWindows) run(tar, ["-a", "-c", "-f", zip, "-C", join(root, ".out/release"), "Sestante"]);
  else run("zip", ["-qr", zip, "Sestante"], { cwd: join(root, ".out/release") });
  console.log(`\n  ${relative(root, zip)}  ${mb(statSync(zip).size)}`);
}
console.log("");
