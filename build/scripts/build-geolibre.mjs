/**
 * Build di GeoLibre a versione fissata, senza fork.
 *
 * Il sorgente di GeoLibre non viene mai modificato: si scarica il commit
 * indicato in build/geolibre/geolibre.lock.json, si depositano i plugin di Sestante
 * nella cartella che GeoLibre prevede per i plugin inclusi nel build
 * (apps/geolibre-desktop/public/plugins/), e si compila con le opzioni di
 * build/geolibre/build.env. Il risultato va in .out/geolibre/web/, che il server
 * serve sotto /gis/.
 *
 *   node build/scripts/build-geolibre.mjs                 scarica (se serve), installa, compila
 *   node build/scripts/build-geolibre.mjs --src <cartella> compila un checkout di sviluppo così com'è (ramo per una PR)
 *   node build/scripts/build-geolibre.mjs --skip-build     solo plugin + copia del dist esistente
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appBase } from "./app-base.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lock = JSON.parse(readFileSync(resolve(root, "build/geolibre/geolibre.lock.json"), "utf8"));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const src = resolve(root, option("--src") ?? ".out/cache/geolibre-src");
const out = resolve(root, ".out/geolibre");
const isWindows = process.platform === "win32";

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: isWindows,
    ...options,
  });
  if (result.status !== 0) {
    console.error(`\n  Comando fallito: ${command} ${commandArgs.join(" ")}\n`);
    process.exit(result.status ?? 1);
  }
}

function git(...gitArgs) {
  return spawnSync("git", gitArgs, { cwd: src, encoding: "utf8" });
}

function step(message) {
  console.log(`\n  ▸ ${message}`);
}

// ── 1. Sorgente ─────────────────────────────────────────────────────────────
// Con --src si compila un checkout di sviluppo così com'è (il ramo su cui si
// prepara una PR per GeoLibre, modifiche non salvate comprese): niente
// checkout del commit fissato. Senza --src, il sorgente è quello del lock.
const localSource = option("--src") !== undefined;
let source = lock;
if (localSource) {
  if (!existsSync(join(src, ".git"))) {
    console.error(`\n  ${src} non è un checkout git di GeoLibre.\n`);
    process.exit(1);
  }
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  const commit = git("rev-parse", "HEAD").stdout.trim();
  const dirty = git("status", "--porcelain", "--untracked-files=no").stdout.trim() !== "";
  source = { repo: `local:${src}`, ref: branch, commit, version: `${branch}${dirty ? "+modifiche" : ""}`, dirty };
  step(`GeoLibre dal checkout di sviluppo ${src} — ramo ${branch} @ ${commit.slice(0, 7)}${dirty ? ", con modifiche non salvate" : ""}`);
  console.log("    Non è la versione fissata: npm run setup la ricompila da build/geolibre/geolibre.lock.json.");
} else {
  step(`GeoLibre ${lock.version} @ ${lock.commit.slice(0, 7)} in ${src}`);
  if (!existsSync(join(src, ".git"))) {
    mkdirSync(src, { recursive: true });
    run("git", ["init", "--quiet"], { cwd: src });
    run("git", ["remote", "add", "origin", lock.repo], { cwd: src });
  }
  const head = git("rev-parse", "HEAD").stdout.trim();
  if (head !== lock.commit) {
    // Dall'URL del lock, non da "origin": il commit può stare su un fork
    // (una PR non ancora accettata), e origin resta il GeoLibre ufficiale.
    run("git", ["fetch", "--depth", "1", lock.repo, lock.commit], { cwd: src });
    run("git", ["checkout", "--quiet", "--force", lock.commit], { cwd: src });
  }
  // Un checkout modificato a mano non è più "GeoLibre a versione fissata".
  const dirty = git("status", "--porcelain", "--untracked-files=no").stdout.trim();
  if (dirty) {
    console.error(
      `\n  Il checkout di GeoLibre ha modifiche locali:\n${dirty}\n` +
        "  Il build deve partire dal sorgente originale. Annulla le modifiche e riprova\n" +
        "  (per compilare un ramo di sviluppo: --src <cartella del checkout>).\n",
    );
    process.exit(1);
  }
}

// ── 1b. Ciò su cui si appoggia l'aggancio della collaborazione ─────────────
// src/server/src/geolibre-bridge.ts guida GeoLibre dall'esterno: questi sono i
// punti del suo codice che dà per scontati. Se un aggiornamento li cambia, il
// build si ferma qui invece di produrre una collaborazione che non entra.
const bridgeAnchors = [
  // Da GeoLibre 3.3.0 sta in un hook a sé (prima era in DesktopShell.tsx).
  ["apps/geolibre-desktop/src/hooks/desktop-shell/useCollabShareLinkAutoOpen.ts", 'get("collab")', "apertura del dialogo da ?collab="],
  ["apps/geolibre-desktop/src/components/layout/DesktopShell.tsx", "useCollabShareLinkAutoOpen(collaboration", "uso dell'apertura da ?collab="],
  ["apps/geolibre-desktop/src/components/layout/CollaborateDialog.tsx", 'id="collab-name"', "campo del nome"],
  ["apps/geolibre-desktop/src/components/layout/CollaborateDialog.tsx", 'id="collab-code"', "campo del codice"],
  ["apps/geolibre-desktop/src/components/layout/CollaborateDialog.tsx", "await api.join(code.trim()", "ingresso dal pulsante del dialogo"],
  ["apps/geolibre-desktop/src/lib/collab-client.ts", "typeof WebSocket = WebSocket", "connessione con il WebSocket della pagina"],
  ["packages/collab-core/src/protocol.ts", "identityToken?: string;", "identità nel messaggio join"],
  ["packages/collab-core/src/protocol.ts", "inviteToken?: string;", "invito nel messaggio join"],
];
const missing = bridgeAnchors.filter(([file, needle]) => {
  const path = join(src, file);
  return !existsSync(path) || !readFileSync(path, "utf8").includes(needle);
});
if (missing.length) {
  console.error(
    "\n  Questa versione di GeoLibre non ha più ciò su cui si appoggia l'aggancio\n" +
      "  della collaborazione (src/server/src/geolibre-bridge.ts):\n" +
      missing.map(([file, needle, what]) => `    - ${what}: «${needle}» in ${file}`).join("\n") +
      "\n  Adegua l'aggancio prima di aggiornare il commit in build/geolibre/geolibre.lock.json.\n",
  );
  process.exit(1);
}

// ── 2. Dipendenze ───────────────────────────────────────────────────────────
// Si reinstallano quando cambia il package-lock di GeoLibre, non solo la prima
// volta: dopo un cambio di versione il codice nuovo con le dipendenze vecchie
// non compila. L'impronta dell'ultimo lock installato sta in node_modules.
const lockFile = join(src, "package-lock.json");
const installedMarker = join(src, "node_modules", ".sestante-lock-sha256");
const lockHash = createHash("sha256").update(readFileSync(lockFile)).digest("hex");
const installedHash = existsSync(installedMarker) ? readFileSync(installedMarker, "utf8").trim() : null;
if (localSource) {
  // Nel checkout di sviluppo le dipendenze le gestisce chi ci lavora
  // (npm install): reinstallarle qui butterebbe via il suo node_modules.
  if (!existsSync(join(src, "node_modules"))) {
    console.error(`\n  Nel checkout ${src} mancano le dipendenze: esegui prima  npm install  lì.\n`);
    process.exit(1);
  }
} else if (installedHash !== lockHash) {
  step(
    existsSync(join(src, "node_modules"))
      ? "Le dipendenze di GeoLibre sono cambiate: le reinstallo"
      : "Installo le dipendenze di GeoLibre (la prima volta richiede qualche minuto)",
  );
  run("npm", ["ci"], { cwd: src });
  writeFileSync(installedMarker, `${lockHash}\n`);
}

// ── 3. Plugin inclusi nel build ─────────────────────────────────────────────
const pluginsSource = resolve(root, "src/plugins");
const pluginsTarget = join(src, "apps/geolibre-desktop/public/plugins");
// La cartella di destinazione è riservata ai drop-in ed è ignorata dal git di
// GeoLibre: si svuota e si riempie da zero, così un plugin rimosso da noi non
// sopravvive nel build.
for (const entry of readdirSync(pluginsTarget)) {
  if (statSync(join(pluginsTarget, entry)).isDirectory()) {
    rmSync(join(pluginsTarget, entry), { recursive: true, force: true });
  }
}
const plugins = [];
for (const entry of existsSync(pluginsSource) ? readdirSync(pluginsSource) : []) {
  const dir = join(pluginsSource, entry);
  if (!statSync(dir).isDirectory()) continue;
  const manifestPath = join(dir, "plugin.json");
  if (!existsSync(manifestPath)) {
    console.warn(`  (salto ${entry}: manca plugin.json)`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.id !== entry) {
    console.error(`\n  Il plugin in src/plugins/${entry} dichiara id "${manifest.id}": devono coincidere.\n`);
    process.exit(1);
  }
  if (!existsSync(join(dir, manifest.entry))) {
    console.error(`\n  Il plugin ${entry} non è compilato: manca ${manifest.entry}.\n`);
    process.exit(1);
  }
  cpSync(dir, join(pluginsTarget, entry), {
    recursive: true,
    filter: (path) => !/[\\/](node_modules|src)([\\/]|$)/.test(path.slice(dir.length)),
  });
  plugins.push({ id: manifest.id, version: manifest.version });
}
step(plugins.length ? `Plugin: ${plugins.map((p) => `${p.id}@${p.version}`).join(", ")}` : "Nessun plugin");

// ── 4. Build ────────────────────────────────────────────────────────────────
const buildEnv = {};
for (const line of readFileSync(resolve(root, "build/geolibre/build.env"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq > 0) buildEnv[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}
// Il percorso di GeoLibre segue quello dell'app: <APP_BASE>gis/. È fissato nel
// build (asset, service worker e worker lo usano in assoluto), quindi va deciso
// qui. APP_BASE dall'ambiente o dal .env; senza, l'app è alla radice.
buildEnv.GEOLIBRE_APP_BASE = `${appBase(root)}gis/`;

if (!flag("--skip-build")) {
  step(`Compilo (${Object.entries(buildEnv).map(([k, v]) => `${k}=${v}`).join(" ")})`);
  run("npm", ["run", "build"], { cwd: src, env: { ...process.env, ...buildEnv } });
}

// ── 5. Copia del risultato ──────────────────────────────────────────────────
const dist = join(src, "apps/geolibre-desktop/dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error(`\n  Build non trovato in ${dist}.\n`);
  process.exit(1);
}
step(`Copio il build in ${join(out, "web")}`);
rmSync(join(out, "web"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(dist, join(out, "web"), { recursive: true });
// I plugin si copiano anche dopo il build: con --skip-build è così che un
// plugin aggiornato arriva nel dist senza ricompilare GeoLibre.
for (const { id } of plugins) {
  cpSync(join(pluginsTarget, id), join(out, "web/plugins", id), { recursive: true });
}
// Il catalogo dei plugin installabili (VITE_GEOLIBRE_PLUGIN_REGISTRY_URL in
// build.env): vuoto, così GeoLibre non lo chiede a plugins.geolibre.app. I
// plugin di Sestante sono già inclusi nel build e non passano di qui.
writeFileSync(join(out, "web/plugin-registry.json"), "[]\n");

// ── 6. Relay di collaborazione, in un solo file ─────────────────────────────
// workers/collab-node è il relay self-hosted di GeoLibre. Lo si raccoglie con
// le sue dipendenze (ws, @geolibre/collab-core) in un unico CommonJS: gira con
// `node relay.cjs` senza node_modules, e il server Sestante lo può caricare con
// require() per ospitarlo nel proprio processo (lo fa l'eseguibile).
step("Raccolgo il relay di collaborazione");
const { build } = await import("esbuild");
rmSync(join(out, "relay"), { recursive: true, force: true });
await build({
  entryPoints: [join(src, "workers/collab-node/src/server.ts")],
  outfile: join(out, "relay/relay.cjs"),
  absWorkingDir: src,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  legalComments: "none",
  // Facoltative per ws, che le cerca dentro un try/catch.
  external: ["bufferutil", "utf-8-validate"],
  // Il sorgente decide se avviarsi da solo confrontando import.meta.url con
  // argv[1]: in CommonJS quell'URL va ricostruito da __filename.
  define: { "import.meta.url": "__relayModuleUrl" },
  banner: { js: 'const __relayModuleUrl = require("node:url").pathToFileURL(__filename).href;' },
});

writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify(
    { geolibre: source, plugins, buildEnv, builtAt: new Date().toISOString() },
    null,
    2,
  ) + "\n",
);
console.log(`\n  GeoLibre pronto in .out/geolibre/web — il server lo serve su /gis/\n`);
