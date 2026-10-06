/**
 * Importa i requisiti in GitHub: un'issue per requisito, con etichette per
 * area, copertura e via di implementazione.
 *
 *   node build/scripts/requisiti-github.mjs <requisiti.json> [--repo antus/sestante] [--dry-run]
 *
 * Il file JSON è un array di oggetti
 *   { id, area, titolo, descrizione,
 *     geolibre: { copertura, nota },
 *     sestante: { copertura, nota, stima, via: [...], approccio } }
 *
 * È ripetibile: un requisito che esiste già come issue (stesso "R-xxx" nel
 * titolo) si salta. I requisiti già coperti del tutto nascono chiusi.
 * Usa la CLI `gh` già autenticata, e procede piano per rispettare i limiti di
 * GitHub sulla creazione di contenuti.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AREE } from "./requisiti-aree.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const repo = args.includes("--repo") ? args[args.indexOf("--repo") + 1] : "antus/sestante";
const dryRun = args.includes("--dry-run");
if (!file) {
  console.error("uso: node build/scripts/requisiti-github.mjs <requisiti.json> [--repo owner/nome] [--dry-run]");
  process.exit(1);
}

/** Etichetta della copertura: solo "parziale" e "assente"; i requisiti completi sono le issue chiuse. */
const coperturaLabel = (c) => (c === "completo" ? null : c);
const COPERTURA = { completo: "2da44e", parziale: "d4a72c", assente: "cf222e" };
const VIE = {
  plugin: "plugin GeoLibre di Sestante",
  server: "server di Sestante",
  shell: "shell (client React di Sestante)",
  ponte: "ponte con GeoLibre",
  upstream: "contributo upstream a GeoLibre",
  infra: "infrastruttura e distribuzione",
  fork: "fork di GeoLibre (da evitare)",
};

function gh(ghArgs, input) {
  return execFileSync("gh", ghArgs, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una chiamata che crea contenuti, con attesa e ritentativi sui limiti secondari di GitHub. */
async function create(apiPath, payload) {
  const dir = mkdtempSync(join(tmpdir(), "req-"));
  const body = join(dir, "body.json");
  writeFileSync(body, JSON.stringify(payload));
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        return JSON.parse(gh(["api", apiPath, "--method", "POST", "--input", body]));
      } catch (error) {
        const text = String(error.stderr ?? error.message);
        if (/already_exists/.test(text)) return null;
        if (attempt < 6 && /secondary rate limit|abuse|403|502|504/i.test(text)) {
          const wait = 30_000 * attempt;
          console.log(`  limite di GitHub, attendo ${wait / 1000}s…`);
          await sleep(wait);
          continue;
        }
        throw new Error(text);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function body(r) {
  const via = (r.sestante.via ?? []).map((v) => VIE[v] ?? v);
  const lines = [
    `**Area:** ${r.area}`,
    "",
    "## Descrizione",
    "",
    r.descrizione,
    "",
    "## Sestante",
    "",
    `**Copertura:** ${r.sestante.copertura}`,
  ];
  if (r.sestante.nota) lines.push("", r.sestante.nota);
  if (r.sestante.approccio) lines.push("", "### Approccio proposto", "", r.sestante.approccio);
  if (via.length) lines.push("", `**Dove si implementa:** ${via.join(", ")}`);
  if (r.sestante.stima && r.sestante.stima !== "—") lines.push("", `**Stima:** ${r.sestante.stima} giorni`);
  lines.push("", "## GeoLibre", "", `**Copertura:** ${r.geolibre.copertura || "non valutata"}`);
  if (r.geolibre.nota) lines.push("", r.geolibre.nota);
  return lines.join("\n");
}

function labelsOf(r) {
  return [
    "requisito",
    AREE[r.area]?.[0],
    coperturaLabel(r.sestante.copertura),
    ...(r.sestante.via ?? []).map((v) => `via: ${v}`),
  ].filter(Boolean);
}

const requisiti = JSON.parse(readFileSync(file, "utf8"));
const unknown = requisiti.filter((r) => !AREE[r.area]);
if (unknown.length) throw new Error(`Aree sconosciute: ${[...new Set(unknown.map((r) => r.area))].join(", ")}`);

// ── Etichette ────────────────────────────────────────────────────────────────
const wanted = new Map([["requisito", ["0e8a16", "Una capacità che Sestante deve offrire"]]]);
for (const [area, [name, color]] of Object.entries(AREE)) wanted.set(name, [color, area]);
for (const [name, color] of Object.entries(COPERTURA)) if (coperturaLabel(name)) wanted.set(coperturaLabel(name), [color, `Copertura in Sestante: ${name}`]);
for (const [name, description] of Object.entries(VIE)) wanted.set(`via: ${name}`, ["c5def5", description]);

const existingLabels = new Set(JSON.parse(gh(["label", "list", "--repo", repo, "--limit", "500", "--json", "name"])).map((l) => l.name));
for (const [name, [color, description]] of wanted) {
  if (existingLabels.has(name)) continue;
  console.log(`etichetta: ${name}`);
  if (!dryRun) await create(`repos/${repo}/labels`, { name, color, description: description.slice(0, 100) });
}

// ── Issue ────────────────────────────────────────────────────────────────────
const existing = new Map();
for (const issue of JSON.parse(
  gh(["issue", "list", "--repo", repo, "--label", "requisito", "--state", "all", "--limit", "2000", "--json", "number,title"]),
)) {
  const id = issue.title.match(/^(R-\d+)/)?.[1];
  if (id) existing.set(id, issue.number);
}

let created = 0;
for (const r of requisiti) {
  if (existing.has(r.id)) continue;
  const title = `${r.id} · ${r.titolo}`.slice(0, 250);
  if (dryRun) {
    console.log(`[prova] ${title}  [${labelsOf(r).join(", ")}]`);
    continue;
  }
  const issue = await create(`repos/${repo}/issues`, { title, body: body(r), labels: labelsOf(r) });
  created++;
  if (r.sestante.copertura === "completo") {
    gh(["issue", "close", String(issue.number), "--repo", repo, "--reason", "completed",
      "--comment", "Già coperto da Sestante al momento dell'importazione."]);
  }
  console.log(`#${issue.number} ${title}`);
  // Circa 25 al minuto: sotto i limiti secondari di GitHub per la creazione di contenuti.
  await sleep(2400);
}
console.log(`\nCreate ${created} issue; ${existing.size} esistevano già.`);
