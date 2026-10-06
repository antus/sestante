# Sestante — immagine del server (e, con un altro comando, del relay).
#
#   docker build -t sestante -f distribution/docker/Dockerfile .     (dalla radice del repository)
#
# Tre stadi:
#   geolibre  build di GeoLibre e del relay alla versione di build/geolibre/geolibre.lock.json.
#             È lo stadio lento (scarica e compila GeoLibre): resta in cache finché
#             non cambiano lock, opzioni di build o plugin.
#   app       server (TypeScript → JavaScript) e client React.
#   runtime   Node "slim" con il solo necessario per girare.
#
# La stessa immagine avvia il relay di collaborazione con:
#   node .out/geolibre/relay/relay.cjs        (vedi distribution/docker/docker-compose.yml)

ARG NODE_VERSION=22

# ── 1. GeoLibre ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm AS geolibre
# Percorso sotto cui sarà pubblicata l'app: GeoLibre lo fissa nel build
# (<APP_BASE>gis/). A runtime va dato lo stesso, con PUBLIC_URL o APP_BASE.
ARG APP_BASE=/
ENV APP_BASE=${APP_BASE}
WORKDIR /src
# esbuild (per impacchettare il relay) arriva dalle dipendenze di Sestante.
COPY package.json package-lock.json ./
COPY src/server/package.json src/server/package.json
COPY src/web/package.json src/web/package.json
RUN npm ci --ignore-scripts
COPY build/scripts/build-geolibre.mjs build/scripts/app-base.mjs build/scripts/
COPY build/geolibre build/geolibre
COPY src/plugins src/plugins
# Il build di GeoLibre è grande: Vite trasforma ~9.000 moduli.
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN node build/scripts/build-geolibre.mjs \
 && rm -rf .out/cache

# ── 2. Server e client ───────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm AS app
WORKDIR /src
COPY package.json package-lock.json ./
COPY src/server/package.json src/server/package.json
COPY src/web/package.json src/web/package.json
RUN npm ci --ignore-scripts
COPY src/server src/server
COPY src/web src/web
RUN npm run build -w @sestante/server \
 && npm run build -w @sestante/web \
 && npm ci --omit=dev --ignore-scripts -w @sestante/server

# ── 3. Esecuzione ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="Sestante" \
      org.opencontainers.image.description="Spazio di lavoro cartografico multi-utente su motore GeoLibre" \
      org.opencontainers.image.authors="Massimo Antonini <massimo.anto@gmail.com>" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
ENV NODE_ENV=production \
    SESTANTE_MODE=server \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/data

COPY --from=app /src/package.json ./package.json
COPY --from=app /src/node_modules ./node_modules
COPY --from=app /src/src/server/package.json ./src/server/package.json
COPY --from=app /src/src/server/dist ./src/server/dist
COPY --from=app /src/src/web/dist ./src/web/dist
COPY --from=geolibre /src/.out/geolibre ./.out/geolibre

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/dist/index.js"]
