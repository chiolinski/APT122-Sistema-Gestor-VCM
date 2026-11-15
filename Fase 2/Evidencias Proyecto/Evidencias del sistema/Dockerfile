FROM node:22-bookworm AS web-build
WORKDIR /vcm
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
COPY api/src/shared ./api/src/shared
RUN npm run build

FROM node:22-bookworm-slim
ENV FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libicu72 libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global azure-functions-core-tools@4.16.0
WORKDIR /vcm
COPY api/package.json api/package-lock.json ./api/
RUN npm --prefix api ci --omit=dev
COPY api/host.json ./api/
COPY api/src ./api/src
COPY api/scripts/init-local.js api/scripts/migrate.js api/scripts/seed-local.js ./api/scripts/
COPY database/migrations ./database/migrations
COPY fixtures ./fixtures
COPY scripts/docker-local.cjs ./scripts/
COPY --from=web-build /vcm/dist ./dist
COPY --from=web-build /vcm/node_modules ./node_modules
COPY vite.config.js package.json ./
RUN install -d -o node -g node /vcm/node_modules/.vite-temp
USER node
CMD ["node", "scripts/docker-local.cjs"]
