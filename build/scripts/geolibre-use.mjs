/**
 * Sceglie la versione di GeoLibre da usare e la fissa in build/geolibre/geolibre.lock.json.
 *
 *   npm run geolibre:use -- v3.3.0     una release (tag)
 *   npm run geolibre:use -- main       la punta di un ramo, fissata al commit di adesso
 *   npm run geolibre:use -- 0692da3f…  un commit preciso (hash completo)
 *   npm run geolibre:use               mostra la versione attuale e le ultime release
 *
 *   npm run geolibre:use -- feat/x --repo antus/GeoLibre
 *       un ramo di un fork: una PR non ancora accettata, da provare insieme o
 *       in Docker prima del merge. È temporaneo: accettata la PR si torna al
 *       GeoLibre ufficiale con --repo opengeos/GeoLibre. Senza --repo resta il
 *       repository del lock attuale. (Guida: docs/sviluppo/CONTRIBUIRE-A-GEOLIBRE.md)
 *
 * Nel lock finisce sempre l'hash del commit: un tag o un ramo possono spostarsi,
 * il commit no, ed è quello che rende il build ripetibile. `ref` ricorda da dove
 * lo si è preso. Dopo il cambio: `npm run build:geolibre` (o `npm run setup`),
 * che ferma il build se l'aggancio della collaborazione non trova più ciò su cui
 * si appoggia, e poi il collaudo di docs/guida/COLLAUDO.md.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lockPath = join(root, "build/geolibre/geolibre.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const args = process.argv.slice(2);
const repoIndex = args.indexOf("--repo");
const repoArg = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
const wanted = args.filter((_, i) => repoIndex < 0 || (i !== repoIndex && i !== repoIndex + 1))[0];

const UPSTREAM = "https://github.com/opengeos/GeoLibre.git";
/** "owner/nome" oppure un URL completo, sempre come URL git. */
function repoUrl(value) {
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return `https://github.com/${value.replace(/\.git$/, "")}.git`;
  return value;
}
const repo = repoArg ? repoUrl(repoArg) : lock.repo;

function lsRemote(...patterns) {
  const result = spawnSync("git", ["ls-remote", repo, ...patterns], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`\n  Impossibile interrogare ${repo}:\n${result.stderr}\n`);
    process.exit(1);
  }
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ref] = line.split("\t");
      return { hash, ref };
    });
}

/** Versioni semantiche in ordine, dalla più recente. */
function byVersionDesc(a, b) {
  const parse = (tag) => tag.replace(/^v/, "").split(".").map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
}

if (!wanted) {
  const tags = lsRemote("--tags", "refs/tags/v*")
    .map((r) => r.ref.replace("refs/tags/", "").replace(/\^\{\}$/, ""))
    .filter((t, i, all) => all.indexOf(t) === i && /^v\d+\.\d+\.\d+$/.test(t))
    .sort(byVersionDesc);
  console.log(
    [
      "",
      `  In uso:   ${lock.ref ?? "(commit)"}  →  ${lock.commit}`,
      ...(lock.repo !== UPSTREAM ? [`  Da:       ${lock.repo}   (un fork: temporaneo, finché la PR non è accettata)`] : []),
      `  Release:  ${tags.slice(0, 8).join("  ")}`,
      "",
      "  Per cambiare:  npm run geolibre:use -- <release | ramo | commit>",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

let commit;
let ref = wanted;
if (/^[0-9a-f]{40}$/.test(wanted)) {
  commit = wanted;
  // Lo stesso commit di prima: si tiene l'etichetta che aveva.
  if (commit === lock.commit && lock.ref) ref = lock.ref;
} else {
  // Un tag annotato compare due volte: il tag stesso e, con ^{}, il commit a
  // cui punta. È il secondo quello che serve.
  const refs = lsRemote(`refs/tags/${wanted}`, `refs/tags/${wanted}^{}`, `refs/heads/${wanted}`);
  const peeled = refs.find((r) => r.ref === `refs/tags/${wanted}^{}`);
  const tag = refs.find((r) => r.ref === `refs/tags/${wanted}`);
  const head = refs.find((r) => r.ref === `refs/heads/${wanted}`);
  commit = (peeled ?? tag ?? head)?.hash;
  if (!commit) {
    console.error(`\n  «${wanted}» non è una release né un ramo di ${repo}.\n`);
    process.exit(1);
  }
  if (head && !tag) ref = `${wanted}@${new Date().toISOString().slice(0, 10)}`;
}

const next = {
  repo,
  ref,
  commit,
  // Solo un'etichetta per le persone: il build usa `commit`.
  version: /^v\d/.test(wanted) ? wanted.replace(/^v/, "") : (lock.version ?? ""),
};
writeFileSync(lockPath, JSON.stringify(next, null, 2) + "\n");

console.log(
  [
    "",
    `  GeoLibre fissato a ${ref}  →  ${commit}`,
    lock.commit === commit ? "  (era già questo)" : `  (prima: ${lock.ref ?? lock.commit})`,
    ...(repo !== UPSTREAM
      ? [`  Da un fork: ${repo}. Accettata la PR, si torna al GeoLibre ufficiale con --repo opengeos/GeoLibre.`]
      : []),
    "",
    "  Ora:  npm run build:geolibre   poi il collaudo in docs/guida/COLLAUDO.md",
    "",
  ].join("\n"),
);
