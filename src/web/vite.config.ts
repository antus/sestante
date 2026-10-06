import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * In sviluppo il client gira su 5173 e il server su 4000: il proxy tiene le due
 * parti sulla stessa origine dal punto di vista del browser, così il cookie di
 * sessione (SameSite=Lax, HttpOnly) funziona senza CORS e senza credenziali
 * cross-site. In produzione il server serve direttamente src/web/dist e il proxy
 * non serve più.
 */
export default defineConfig(({ command }) => ({
  // Indirizzi relativi nel build: il server mette nella pagina il <base href>
  // del percorso dell'app, e lo stesso build vale alla radice e sotto /sestante/.
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: false,
      },
      // GeoLibre, servito dal server Sestante: passando dal proxy resta sulla
      // stessa origine del client anche in sviluppo.
      "/gis": {
        target: "http://127.0.0.1:4000",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
}));
