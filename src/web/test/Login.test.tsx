import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../src/lib/api";
import { DICT, I18nProvider } from "../src/lib/i18n";
import { ThemeProvider } from "../src/lib/theme";
import { Login } from "../src/screens/Login";

const LOCAL: ServerConfig = {
  keycloakEnabled: false,
  allowLocalSignup: true,
  orgLabel: "example.org",
  orgDomain: "example.org",
  geolibreUrl: "/gis/",
} as ServerConfig;

function renderLogin(config: ServerConfig = LOCAL) {
  const onAuthenticated = vi.fn();
  render(
    <I18nProvider>
      <ThemeProvider>
        <Login config={config} onAuthenticated={onAuthenticated} />
      </ThemeProvider>
    </I18nProvider>,
  );
  return { onAuthenticated, user: userEvent.setup() };
}

function stubFetch(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("schermata d'accesso", () => {
  it("con le credenziali giuste consegna l'utente all'app", async () => {
    const fetch = stubFetch(200, { user: { id: "u1", email: "a@example.org" } });
    const { onAuthenticated, user } = renderLogin();
    await user.clear(screen.getByLabelText(DICT.it["login.email"]));
    await user.type(screen.getByLabelText(DICT.it["login.email"]), "a@example.org");
    await user.type(screen.getByLabelText(DICT.it["login.pass"]), "segreta-2026");
    await user.click(screen.getByRole("button", { name: DICT.it["login.submit"] }));

    expect(fetch).toHaveBeenCalledOnce();
    expect(onAuthenticated).toHaveBeenCalledWith({ id: "u1", email: "a@example.org" });
  });

  it("con le credenziali sbagliate mostra il messaggio tradotto e resta qui", async () => {
    stubFetch(401, { error: "invalid-credentials" });
    const { onAuthenticated, user } = renderLogin();
    await user.type(screen.getByLabelText(DICT.it["login.pass"]), "sbagliata");
    await user.click(screen.getByRole("button", { name: DICT.it["login.submit"] }));

    expect(await screen.findByText(DICT.it["err.invalid-credentials"])).toBeTruthy();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("un codice d'errore sconosciuto non arriva grezzo all'utente", async () => {
    stubFetch(500, { error: "internal-error" });
    const { user } = renderLogin();
    await user.type(screen.getByLabelText(DICT.it["login.pass"]), "x");
    await user.click(screen.getByRole("button", { name: DICT.it["login.submit"] }));

    expect(await screen.findByText(DICT.it["err.generic"])).toBeTruthy();
    expect(screen.queryByText(/internal-error/)).toBeNull();
  });

  it("con Keycloak configurato propone l'SSO, sotto il percorso dell'app", () => {
    renderLogin({ ...LOCAL, keycloakEnabled: true });
    const sso = screen.getByRole("link", { name: DICT.it["login.sso"] });
    expect(sso.getAttribute("href")).toBe("/api/auth/keycloak/start?returnTo=/");
  });

  it("senza Keycloak non c'è il pulsante SSO", () => {
    renderLogin();
    expect(screen.queryByRole("link", { name: DICT.it["login.sso"] })).toBeNull();
  });

  it("la registrazione si offre solo se il server la permette", async () => {
    const { user } = renderLogin();
    await user.click(screen.getByRole("button", { name: DICT.it["login.toSignup"] }));
    expect(screen.getByLabelText(DICT.it["login.name"])).toBeTruthy();
    cleanup();

    renderLogin({ ...LOCAL, allowLocalSignup: false });
    expect(screen.queryByRole("button", { name: DICT.it["login.toSignup"] })).toBeNull();
  });
});
