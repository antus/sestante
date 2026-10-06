import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPrefs, savePrefs } from "../src/lib/prefs";

const KEY = "sestante.prefs";

afterEach(() => localStorage.clear());

describe("preferenze locali", () => {
  it("senza nulla di salvato valgono italiano, tema di sistema e accento blu", () => {
    expect(loadPrefs()).toEqual({ locale: "it", theme: "system", accent: "blue" });
  });

  it("si salvano un pezzo alla volta, senza perdere il resto", () => {
    savePrefs({ theme: "dark" });
    savePrefs({ locale: "en" });
    expect(loadPrefs()).toEqual({ locale: "en", theme: "dark", accent: "blue" });
  });

  it("valori sconosciuti o manomessi tornano ai predefiniti, uno per uno", () => {
    localStorage.setItem(KEY, JSON.stringify({ locale: "fr", theme: "dark", accent: "<script>" }));
    expect(loadPrefs()).toEqual({ locale: "it", theme: "dark", accent: "blue" });
  });

  it("un contenuto illeggibile non rompe l'avvio", () => {
    localStorage.setItem(KEY, "{non json");
    expect(loadPrefs()).toEqual({ locale: "it", theme: "system", accent: "blue" });
  });

  it("con lo storage bloccato (finestra anonima) lettura e scrittura non lanciano", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloccato", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("bloccato", "SecurityError");
    });
    expect(() => savePrefs({ theme: "dark" })).not.toThrow();
    expect(loadPrefs().theme).toBe("system");
  });
});
