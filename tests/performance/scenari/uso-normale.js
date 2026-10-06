/**
 * Un gruppo di lavoro sulle stesse mappe: elenca, apre, salva il progetto,
 * guarda i file. È il percorso delle API che la dashboard e l'editor fanno
 * di continuo; GeoLibre e i file statici non c'entrano (li serve la cache).
 *
 * Profili (K6_PROFILO): "fumo" 1 utente per 15 s, per vedere che lo scenario
 * gira; "carico" (default) fino a 20 utenti contemporanei per 2 minuti.
 *
 * Soglie: meno dell'1% di errori, 95% delle risposte sotto i 500 ms.
 */
import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE = (__ENV.BASE_URL || "http://localhost:4184").replace(/\/+$/, "");
const PASSWORD = __ENV.PASSWORD || "sestante2026";
const USERS = ["m.antonini@example.org", "e.ricci@example.org"];

const PROFILI = {
  fumo: { vus: 1, duration: "15s" },
  carico: {
    stages: [
      { duration: "30s", target: 20 },
      { duration: "1m", target: 20 },
      { duration: "15s", target: 0 },
    ],
  },
};

export const options = {
  ...PROFILI[__ENV.K6_PROFILO || "carico"],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    checks: ["rate>0.99"],
  },
};

const json = { headers: { "content-type": "application/json" } };

function login(email) {
  const response = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), json);
  check(response, { "accesso": (r) => r.status === 200 });
  const cookie = response.cookies.sestante_session && response.cookies.sestante_session[0];
  if (!cookie) throw new Error(`accesso di ${email} non riuscito: ${response.status}`);
  return `sestante_session=${cookie.value}`;
}

/** Una mappa condivisa in scrittura fra gli utenti, con un file caricato. */
export function setup() {
  const [owner, editor] = USERS.map(login);
  const created = http.post(`${BASE}/api/maps`, JSON.stringify({ name: "Prova di carico" }), {
    headers: { ...json.headers, cookie: owner },
  });
  const mapId = created.json("map.id");
  http.post(`${BASE}/api/maps/${mapId}/shares`, JSON.stringify({ email: USERS[1], role: "editor" }), {
    headers: { ...json.headers, cookie: owner },
  });
  const geojson = {
    type: "FeatureCollection",
    features: Array.from({ length: 200 }, (_, i) => ({
      type: "Feature",
      properties: { n: i },
      geometry: { type: "Point", coordinates: [12 + i / 1000, 41.9] },
    })),
  };
  http.post(`${BASE}/api/maps/${mapId}/files`, JSON.stringify({ name: "punti.geojson", geojson }), {
    headers: { ...json.headers, cookie: owner },
  });
  return { mapId, cookies: [owner, editor] };
}

export default function ({ mapId, cookies }) {
  const cookie = cookies[__VU % cookies.length];
  const params = { headers: { ...json.headers, cookie } };

  group("dashboard", () => {
    const list = http.get(`${BASE}/api/maps`, params);
    check(list, { "elenco delle mappe": (r) => r.status === 200 });
  });

  group("editor", () => {
    const map = http.get(`${BASE}/api/maps/${mapId}`, params);
    check(map, { "apertura della mappa": (r) => r.status === 200 });
    const files = http.get(`${BASE}/api/maps/${mapId}/files`, params);
    check(files, { "elenco dei file": (r) => r.status === 200 });

    const project = {
      layers: [{ id: `livello-${__VU}`, name: "Punti", source: { type: "geojson" } }],
      view: { center: [12.49, 41.89], zoom: 10 + (__ITER % 5) },
    };
    const saved = http.patch(`${BASE}/api/maps/${mapId}`, JSON.stringify({ project }), params);
    check(saved, { "salvataggio del progetto": (r) => r.status === 200 });
  });

  sleep(1);
}
