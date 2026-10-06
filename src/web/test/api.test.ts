import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/lib/api";

function respond(status: number, body?: unknown) {
  const fetch = vi.fn(async () =>
    new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("client delle API", () => {
  it("manda le credenziali come JSON, sulla stessa origine", async () => {
    const fetch = respond(200, { user: { id: "u" } });
    await api.login("a@example.org", "segreta-2026");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@example.org", password: "segreta-2026" });
  });

  it("un errore del server diventa un ApiError con il suo codice", async () => {
    respond(401, { error: "invalid-credentials" });
    const error = await api.login("a@example.org", "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "invalid-credentials" });
  });

  it("un errore senza corpo leggibile vale come generico", async () => {
    respond(502, "<html>Bad gateway</html>");
    await expect(api.me()).rejects.toMatchObject({ status: 502, code: "generic" });
  });

  it("senza rete l'errore lo dice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: "network" });
  });
});
