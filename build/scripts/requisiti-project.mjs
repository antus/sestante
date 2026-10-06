/**
 * Crea (o aggiorna) il GitHub Project "Requisiti di Sestante" e vi porta le
 * issue con etichetta `requisito`, compilandone i campi.
 *
 *   node build/scripts/requisiti-project.mjs <requisiti.json> [--owner antus] [--repo antus/sestante]
 *
 * Campi del Project:
 *   Status              Todo per i requisiti aperti, Done per quelli chiusi
 *   Area                le 17 aree
 *   Copertura Sestante  assente / parziale / completo
 *   Copertura GeoLibre  assente / parziale / completo / non valutata
 *   Stima min, Stima max (giorni)
 *   Priorità            P1 / P2 / P3, vuota: la decide il team
 *
 * I valori vengono dal file JSON dell'importazione (lo stesso di
 * requisiti-github.mjs). È ripetibile: le issue già nel Project si saltano.
 * Richiede `gh` con il permesso `project` (gh auth refresh -s project).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { AREE_ELENCO } from "./requisiti-aree.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const owner = opt("--owner", "antus");
const repo = opt("--repo", "antus/sestante");
const TITLE = "Requisiti di Sestante";
if (!file) {
  console.error("uso: node build/scripts/requisiti-project.mjs <requisiti.json> [--owner utente] [--repo owner/nome]");
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function graphql(query, variables = {}) {
  const payload = JSON.stringify({ query, variables });
  for (let attempt = 1; ; attempt++) {
    try {
      const out = execFileSync("gh", ["api", "graphql", "--input", "-"], { input: payload, encoding: "utf8" });
      const json = JSON.parse(out);
      if (json.errors) throw new Error(JSON.stringify(json.errors));
      return json.data;
    } catch (error) {
      const text = String(error.stderr ?? error.message);
      if (attempt < 5 && /rate limit|abuse|502|504|timeout/i.test(text)) {
        execFileSync(process.execPath, ["-e", `setTimeout(()=>{}, ${20_000 * attempt})`]);
        continue;
      }
      throw new Error(text);
    }
  }
}

const COPERTURA = ["assente", "parziale", "completo"];
const COLORI_AREA = ["BLUE", "PURPLE", "PINK", "RED", "BLUE", "GREEN", "YELLOW", "ORANGE", "PURPLE", "GRAY", "BLUE", "GREEN", "YELLOW", "GRAY", "ORANGE", "BLUE", "RED"];
const colorCopertura = { assente: "RED", parziale: "YELLOW", completo: "GREEN", "non valutata": "GRAY" };

// ── Project ──────────────────────────────────────────────────────────────────
const { user } = graphql(
  `query($login: String!) { user(login: $login) { id projectsV2(first: 100) { nodes { id number title url } } } }`,
  { login: owner },
);
let project = user.projectsV2.nodes.find((p) => p.title === TITLE);
if (!project) {
  project = graphql(
    `mutation($owner: ID!, $title: String!) { createProjectV2(input: { ownerId: $owner, title: $title }) { projectV2 { id number title url } } }`,
    { owner: user.id, title: TITLE },
  ).createProjectV2.projectV2;
  console.log(`creato il Project ${project.url}`);
}
const [repoOwner, repoName] = repo.split("/");
const { repository } = graphql(`query($o: String!, $n: String!) { repository(owner: $o, name: $n) { id } }`, {
  o: repoOwner,
  n: repoName,
});
try {
  graphql(`mutation($p: ID!, $r: ID!) { linkProjectV2ToRepository(input: { projectId: $p, repositoryId: $r }) { clientMutationId } }`, {
    p: project.id,
    r: repository.id,
  });
} catch (error) {
  if (!/already/i.test(String(error.message))) throw error;
}

// ── Campi ────────────────────────────────────────────────────────────────────
function fields() {
  return graphql(
    `query($p: ID!) { node(id: $p) { ... on ProjectV2 { fields(first: 50) { nodes {
        ... on ProjectV2Field { id name dataType }
        ... on ProjectV2SingleSelectField { id name dataType options { id name } } } } } } }`,
    { p: project.id },
  ).node.fields.nodes;
}
function ensureSelect(name, options) {
  if (fields().some((f) => f.name === name)) return;
  graphql(
    `mutation($p: ID!, $name: String!, $opts: [ProjectV2SingleSelectFieldOptionInput!]!) {
       createProjectV2Field(input: { projectId: $p, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $opts }) { clientMutationId } }`,
    { p: project.id, name, opts: options },
  );
  console.log(`campo: ${name}`);
}
function ensureNumber(name) {
  if (fields().some((f) => f.name === name)) return;
  graphql(`mutation($p: ID!, $name: String!) { createProjectV2Field(input: { projectId: $p, dataType: NUMBER, name: $name }) { clientMutationId } }`, {
    p: project.id,
    name,
  });
  console.log(`campo: ${name}`);
}
ensureSelect("Area", AREE_ELENCO.map((name, i) => ({ name, color: COLORI_AREA[i % COLORI_AREA.length], description: "" })));
ensureSelect("Copertura Sestante", COPERTURA.map((name) => ({ name, color: colorCopertura[name], description: "" })));
ensureSelect("Copertura GeoLibre", [...COPERTURA, "non valutata"].map((name) => ({ name, color: colorCopertura[name], description: "" })));
ensureNumber("Stima min");
ensureNumber("Stima max");
ensureSelect("Priorità", [
  { name: "P1", color: "RED", description: "Da fare per prima" },
  { name: "P2", color: "YELLOW", description: "Importante" },
  { name: "P3", color: "GRAY", description: "Quando c'è tempo" },
]);

const byName = Object.fromEntries(fields().map((f) => [f.name, f]));
const option = (field, name) => byName[field].options.find((o) => o.name === name)?.id;

// ── Elementi ─────────────────────────────────────────────────────────────────
const inProject = new Set();
let cursor = null;
do {
  const page = graphql(
    `query($p: ID!, $after: String) { node(id: $p) { ... on ProjectV2 { items(first: 100, after: $after) {
       pageInfo { hasNextPage endCursor } nodes { content { ... on Issue { id } } } } } } }`,
    { p: project.id, after: cursor },
  ).node.items;
  for (const item of page.nodes) if (item.content?.id) inProject.add(item.content.id);
  cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (cursor);

const requisiti = new Map(JSON.parse(readFileSync(file, "utf8")).map((r) => [r.id, r]));
const issues = JSON.parse(
  execFileSync("gh", ["issue", "list", "--repo", repo, "--label", "requisito", "--state", "all", "--limit", "2000", "--json", "id,number,title,state"], {
    encoding: "utf8",
  }),
);

let added = 0;
for (const issue of issues.sort((a, b) => a.number - b.number)) {
  if (inProject.has(issue.id)) continue;
  const r = requisiti.get(issue.title.match(/^(R-\d+)/)?.[1]);
  const itemId = graphql(`mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }`, {
    p: project.id,
    c: issue.id,
  }).addProjectV2ItemById.item.id;

  // Tutti i campi dell'elemento in una sola richiesta, con gli alias.
  const sets = [];
  const single = (alias, field, optionId) =>
    optionId && sets.push(`${alias}: updateProjectV2ItemFieldValue(input: { projectId: "${project.id}", itemId: "${itemId}", fieldId: "${byName[field].id}", value: { singleSelectOptionId: "${optionId}" } }) { clientMutationId }`);
  const number = (alias, field, value) =>
    Number.isFinite(value) && sets.push(`${alias}: updateProjectV2ItemFieldValue(input: { projectId: "${project.id}", itemId: "${itemId}", fieldId: "${byName[field].id}", value: { number: ${value} } }) { clientMutationId }`);
  single("status", "Status", option("Status", issue.state === "CLOSED" ? "Done" : "Todo"));
  if (r) {
    single("area", "Area", option("Area", r.area));
    single("cs", "Copertura Sestante", option("Copertura Sestante", r.sestante.copertura));
    single("cg", "Copertura GeoLibre", option("Copertura GeoLibre", r.geolibre.copertura || "non valutata"));
    if (r.sestante.stimaMax > 0) {
      number("smin", "Stima min", r.sestante.stimaMin);
      number("smax", "Stima max", r.sestante.stimaMax);
    }
  }
  if (sets.length) graphql(`mutation { ${sets.join("\n")} }`);
  added++;
  console.log(`#${issue.number} ${issue.title.slice(0, 70)}`);
  await sleep(400);
}
console.log(`\nAggiunte ${added} issue al Project ${project.url}`);
