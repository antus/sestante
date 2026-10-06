/**
 * Preferenze locali del browser: lingua, tema e accento.
 *
 * Sono duplicate anche sul profilo utente lato server, ma qui servono a due
 * cose che il server non può fare: applicare il tema prima del primo paint
 * (vedi lo script inline in index.html) e non perdere la scelta di chi non ha
 * ancora effettuato l'accesso. Ogni lettura e scrittura è protetta: in una
 * finestra anonima o con i dati di sito bloccati, l'accesso allo storage lancia.
 */
import type { Locale } from "./i18n";

export type ThemeMode = "light" | "dark" | "system";
export type Accent = "blue" | "violet" | "emerald" | "rose" | "amber";

export interface Prefs {
  locale: Locale;
  theme: ThemeMode;
  accent: Accent;
}

const KEY = "sestante.prefs";
const DEFAULTS: Prefs = { locale: "it", theme: "system", accent: "blue" };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      locale: parsed.locale === "en" || parsed.locale === "it" ? parsed.locale : DEFAULTS.locale,
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
          ? parsed.theme
          : DEFAULTS.theme,
      accent: (["blue", "violet", "emerald", "rose", "amber"] as const).includes(
        parsed.accent as Accent,
      )
        ? (parsed.accent as Accent)
        : DEFAULTS.accent,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* storage non disponibile: la preferenza vale per questa sessione soltanto */
  }
}
