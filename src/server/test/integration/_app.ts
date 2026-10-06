/**
 * L'applicazione vera (buildApp), interrogata con app.inject(): richieste HTTP
 * complete — rotte, hook, cookie, errori — senza aprire una porta. Il database
 * è quello temporaneo di ../_env.ts, da importare per primo.
 */
import { strict as assert } from "node:assert";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../../src/app.js";
import { createLocalUser } from "../../src/users.js";

export const PASSWORD = "password-sicura-2026";

export interface Client {
  email: string;
  cookie: string | null;
  call(method: InjectOptions["method"], url: string, payload?: unknown): Promise<{ status: number; body: any }>;
}

let app: FastifyInstance | null = null;

export async function server(): Promise<FastifyInstance> {
  app ??= await buildApp();
  return app;
}

function client(email: string, cookie: string | null): Client {
  return {
    email,
    cookie,
    async call(method, url, payload) {
      const response = await (await server()).inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload: payload as InjectOptions["payload"] }),
        headers: cookie ? { cookie } : {},
      });
      let body: unknown = null;
      try {
        body = response.json();
      } catch {
        body = response.body;
      }
      return { status: response.statusCode, body };
    },
  };
}

/** Un utente locale nuovo, già entrato. */
export async function signedIn(email: string, name = email.split("@")[0]!): Promise<Client> {
  await createLocalUser(email, name, PASSWORD);
  const response = await (await server()).inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `accesso di ${email}`);
  const cookie = response.cookies.find((c) => c.name === "sestante_session");
  assert.ok(cookie, "cookie di sessione");
  return client(email, `sestante_session=${cookie.value}`);
}

export const anonymous = (): Client => client("anonimo", null);

export const FEATURES = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [12.5, 41.9] } }],
};
