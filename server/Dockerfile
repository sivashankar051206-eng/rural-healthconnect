# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home /app app \
 && mkdir -p /var/lib/rhc/uploads && chown -R app:app /var/lib/rhc && chmod 700 /var/lib/rhc/uploads
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
COPY --chown=app:app migrations ./migrations
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
