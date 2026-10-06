/**
 * Il percorso dell'app si legge una volta, all'import, dal <base href> che il
 * server mette nella pagina: ogni caso reimporta il modulo con il suo documento.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWithBase(href: string | null) {
  document.head.innerHTML = href === null ? "" : `<base href="${href}">`;
  vi.resetModules();
  return import("../src/lib/base");
}

afterEach(() => {
  document.head.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("percorso dell'app", () => {
  it("senza <base> (sviluppo con Vite) vale la radice", async () => {
    const { APP_BASE, appPath } = await loadWithBase(null);
    expect(APP_BASE).toBe("/");
    expect(appPath("/api/maps")).toBe("/api/maps");
  });

  it("sotto un percorso, le API e le rotte lo portano con sé", async () => {
    const { APP_BASE, appPath } = await loadWithBase("/sestante/");
    expect(APP_BASE).toBe("/sestante/");
    expect(appPath("/api/maps")).toBe("/sestante/api/maps");
    expect(appPath("api/maps")).toBe("/sestante/api/maps");
    expect(appPath("//m/x")).toBe("/sestante/m/x");
  });

  it("aggiunge la barra finale se il <base> non ce l'ha", async () => {
    const { APP_BASE } = await loadWithBase("/sestante");
    expect(APP_BASE).toBe("/sestante/");
  });

  it("la rotta corrente è il percorso senza la base", async () => {
    const { currentRoute } = await loadWithBase("/sestante/");
    window.history.replaceState(null, "", "/sestante/m/abc");
    expect(currentRoute()).toBe("/m/abc");
    window.history.replaceState(null, "", "/altro/m/abc");
    expect(currentRoute()).toBe("/altro/m/abc");
  });
});
