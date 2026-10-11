# syntax=docker/dockerfile:1
#
# spindle — multi-stage build (node:24-slim on every stage).
# Node 24 LTS: the runtime toolchain floor. @zxing/library requires node >=24
# (enforced by engine-strict in .npmrc); better-sqlite3 and SvelteKit are happy.
# The runner stage reinstalls runtime deps for the *target* platform so the
# better-sqlite3 native prebuild matches whatever arch the image runs on
# (arm64 Mac dev → amd64 Linux server via buildx, no rebuild-toolchain needed).

# ---- 1. deps: full install (the build needs the svelte/tailwind/vite toolchain) ----
# --ignore-scripts: no package in this tree needs a lifecycle script at runtime.
# better-sqlite3 bundles prebuilds for every platform (see runner stage); npm's
# default would otherwise run node-gyp on it and need a C/Python toolchain.
# rolldown/lightningcss ship their native binaries as plain optional packages.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

# ---- 2. build: compile the SvelteKit app (adapter-node → /app/build) ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- 3. runner: runtime only, non-root, no toolchain ----
FROM node:24-slim AS runner
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    BODY_SIZE_LIMIT=10M
WORKDIR /app

# Runtime deps only, for THIS stage's platform. --ignore-scripts skips npm's
# automatic node-gyp build of better-sqlite3 (it needs a C/Python toolchain that
# slim lacks) — unneeded because better-sqlite3 bundles prebuilds for every
# platform in the package and its loader picks up prebuilds/<platform>-<arch>.node
# at require time. fsevents (the one install-script dep) is macOS-only, so it is
# simply not installed on Linux; nothing here needs a lifecycle script to run.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# adapter-node output (server + client + copied static assets)
COPY --from=build /app/build ./build

# Stock non-root user from the node image. On Linux hosts, chown the bind
# mount before first run:  mkdir -p data && chown -R 1000:1000 data
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "build/index.js"]
