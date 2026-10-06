/**
 * Il test che conta di più del progetto.
 *
 * L'identityToken è il punto in cui Sestante e GeoLibre devono essere d'accordo
 * byte per byte: se il formato diverge, il relay verifica a null, ogni utente
 * entra anonimo e la presenza smette silenziosamente di essere attendibile —
 * senza alcun errore visibile. I vettori qui sotto sono calcolati secondo la
 * specifica di `packages/collab-core/src/identity.ts`:
 *
 *   <base64url(payloadJSON)>.<base64url(hmacSha256(base64url(payloadJSON))))>
 *
 * Il test verifica anche i modi in cui un token deve fallire, perché è lì che
 * un'implementazione sbagliata diventa un problema di sicurezza e non un bug.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { signIdentityToken, verifyIdentityToken } from "../src/identity-token.js";

const SECRET = "un-segreto-di-prova";

test("il token ha due segmenti base64url senza padding", () => {
  const token = signIdentityToken({ userId: "u1", username: "Massimo Antonini" }, SECRET);
  const parts = token.split(".");
  assert.equal(parts.length, 2);
  for (const part of parts) {
    assert.match(part, /^[A-Za-z0-9_-]+$/, "solo alfabeto base64url, nessun '=' di padding");
  }
});

test("la firma è calcolata sul payload CODIFICATO, non sull'oggetto", () => {
  const payload = { userId: "u1", username: "Massimo" };
  const token = signIdentityToken(payload, SECRET);
  const [encodedPayload, signature] = token.split(".") as [string, string];

  const expected = createHmac("sha256", SECRET)
    .update(encodedPayload, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  assert.equal(signature, expected);
});

test("il payload decodificato contiene esattamente i claim previsti", () => {
  const token = signIdentityToken(
    { userId: "abc", username: "Elena Ricci", provider: "sestante", exp: 4102444800 },
    SECRET,
  );
  const [encodedPayload] = token.split(".") as [string];
  const json = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

  assert.deepEqual(json, {
    userId: "abc",
    username: "Elena Ricci",
    provider: "sestante",
    exp: 4102444800,
  });
});

test("round-trip: un token firmato si verifica con lo stesso segreto", () => {
  const token = signIdentityToken({ userId: "u42", username: "Sara Lombardi" }, SECRET);
  const identity = verifyIdentityToken(token, SECRET);
  assert.ok(identity);
  assert.equal(identity.userId, "u42");
  assert.equal(identity.username, "Sara Lombardi");
  assert.equal(identity.provider, "geolibre", "provider assente ricade sul default del relay");
});

test("un segreto diverso non verifica", () => {
  const token = signIdentityToken({ userId: "u1", username: "X" }, SECRET);
  assert.equal(verifyIdentityToken(token, "altro-segreto"), null);
});

test("senza segreto configurato ogni token è anonimo", () => {
  const token = signIdentityToken({ userId: "u1", username: "X" }, SECRET);
  assert.equal(verifyIdentityToken(token, ""), null);
  assert.equal(verifyIdentityToken(token, undefined), null);
});

test("un payload manomesso invalida la firma", () => {
  const token = signIdentityToken({ userId: "u1", username: "utente" }, SECRET);
  const [, signature] = token.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ userId: "admin", username: "admin" }), "utf8")
    .toString("base64url");
  assert.equal(verifyIdentityToken(`${forged}.${signature}`, SECRET), null);
});

test("un token scaduto è rifiutato, exp è in secondi", () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  const token = signIdentityToken({ userId: "u1", username: "X", exp: past }, SECRET);
  assert.equal(verifyIdentityToken(token, SECRET), null);

  const future = Math.floor(Date.now() / 1000) + 600;
  const valid = signIdentityToken({ userId: "u1", username: "X", exp: future }, SECRET);
  assert.ok(verifyIdentityToken(valid, SECRET));
});

test("token malformati non passano", () => {
  for (const bad of ["", "senza-punto", "a.b.c", "payload.", ".firma", "!!!.???"]) {
    assert.equal(verifyIdentityToken(bad, SECRET), null, `doveva fallire: ${bad}`);
  }
});

test("claim obbligatori mancanti: nessuna identità", () => {
  const encoded = Buffer.from(JSON.stringify({ username: "solo-nome" }), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", SECRET)
    .update(encoded, "utf8")
    .digest("base64url");
  assert.equal(verifyIdentityToken(`${encoded}.${signature}`, SECRET), null);
});

test("un nome con caratteri non ASCII sopravvive al round-trip", () => {
  const token = signIdentityToken({ userId: "u1", username: "Niccolò D'Angiò" }, SECRET);
  const identity = verifyIdentityToken(token, SECRET);
  assert.equal(identity?.username, "Niccolò D'Angiò");
});
