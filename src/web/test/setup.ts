/** Dopo ogni test si smonta ciò che Testing Library ha montato. */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

/**
 * jsdom non ha matchMedia: il tema la usa per seguire il sistema. Qui il
 * sistema è "chiaro", e un test può cambiarlo con setSystemDark.
 */
let systemDark = false;
const listeners = new Set<(event: { matches: boolean }) => void>();
export function setSystemDark(dark: boolean): void {
  systemDark = dark;
  for (const listener of listeners) listener({ matches: dark });
}
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    get matches() {
      return query.includes("dark") && systemDark;
    },
    media: query,
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
  }),
});
afterEach(() => {
  systemDark = false;
  listeners.clear();
});
