/**
 * Tema dell'applicazione: chiaro / scuro / sistema, più i cinque schemi
 * d'accento di GeoLibre.
 *
 * Lo stato risolto ("dark" o "light") viene stampato come classe sull'elemento
 * radice e, da lì, raggiunge due destinazioni: i token CSS della chrome e il
 * parametro `theme` con cui viene montata l'istanza GeoLibre. Il secondo è il
 * motivo per cui `resolved` è esposto: l'iframe va rimontato quando cambia,
 * perché il protocollo embed v2 non ha un comando per cambiare tema a caldo.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { loadPrefs, savePrefs, type Accent, type ThemeMode } from "./prefs";

interface ThemeValue {
  mode: ThemeMode;
  accent: Accent;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initial = loadPrefs();
  const [mode, setModeState] = useState<ThemeMode>(initial.theme);
  const [accent, setAccentState] = useState<Accent>(initial.accent);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("theme-dark", resolved === "dark");
    root.classList.toggle("theme-light", resolved === "light");
    if (accent === "blue") root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", accent);
  }, [resolved, accent]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    savePrefs({ theme: next });
  }, []);

  const setAccent = useCallback((next: Accent) => {
    setAccentState(next);
    savePrefs({ accent: next });
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ mode, accent, resolved, setMode, setAccent }),
    [mode, accent, resolved, setMode, setAccent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme va usato dentro <ThemeProvider>");
  return value;
}
