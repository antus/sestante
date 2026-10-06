import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DICT, I18nProvider, useI18n } from "../src/lib/i18n";

afterEach(() => localStorage.clear());

describe("traduzioni", () => {
  it("italiano e inglese hanno esattamente le stesse chiavi", () => {
    const it = Object.keys(DICT.it).sort();
    const en = Object.keys(DICT.en).sort();
    expect(en.filter((k) => !it.includes(k)), "solo in inglese").toEqual([]);
    expect(it.filter((k) => !en.includes(k)), "solo in italiano").toEqual([]);
  });

  it("i segnaposto coincidono fra le lingue", () => {
    const it = DICT.it as Record<string, string>;
    const en = DICT.en as Record<string, string>;
    for (const key of Object.keys(it)) {
      expect(en[key]?.includes("{n}"), key).toBe(it[key]!.includes("{n}"));
    }
  });

  it("nessun testo è vuoto", () => {
    for (const [locale, table] of Object.entries(DICT)) {
      for (const [key, value] of Object.entries(table)) expect(String(value).trim(), `${locale}.${key}`).not.toBe("");
    }
  });
});

function Probe() {
  const { t, setLocale, relative } = useI18n();
  return (
    <div>
      <span data-testid="submit">{t("login.submit")}</span>
      <span data-testid="relative">{relative(Date.now() - 5 * 60_000)}</span>
      <button onClick={() => setLocale("en")}>en</button>
    </div>
  );
}

describe("I18nProvider", () => {
  it("cambia lingua, la ricorda e la dichiara nel documento", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("submit").textContent).toBe(DICT.it["login.submit"]);
    act(() => screen.getByText("en").click());
    expect(screen.getByTestId("submit").textContent).toBe(DICT.en["login.submit"]);
    expect(screen.getByTestId("relative").textContent).toBe("5 min ago");
    expect(document.documentElement.lang).toBe("en");
    expect(JSON.parse(localStorage.getItem("sestante.prefs")!).locale).toBe("en");
  });

  it("parte dalla lingua salvata", () => {
    localStorage.setItem("sestante.prefs", JSON.stringify({ locale: "en" }));
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("submit").textContent).toBe(DICT.en["login.submit"]);
  });
});
