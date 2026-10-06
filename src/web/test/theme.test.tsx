import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "../src/lib/theme";
import { setSystemDark } from "./setup";

function Probe() {
  const { resolved, setMode, setAccent } = useTheme();
  return (
    <div>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setMode("dark")}>scuro</button>
      <button onClick={() => setMode("system")}>sistema</button>
      <button onClick={() => setAccent("rose")}>rosa</button>
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-accent");
});

describe("tema", () => {
  it("in modalità sistema segue il sistema, anche quando cambia", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    act(() => setSystemDark(true));
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
  });

  it("una scelta esplicita vince sul sistema e si ricorda", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByText("scuro").click());
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
    expect(JSON.parse(localStorage.getItem("sestante.prefs")!).theme).toBe("dark");
  });

  it("l'accento si applica al documento; il blu è quello predefinito", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
    act(() => screen.getByText("rosa").click());
    expect(document.documentElement.getAttribute("data-accent")).toBe("rose");
  });
});
