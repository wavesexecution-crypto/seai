# SEAI (Node.js / Express) — production Dockerfile
# Compiles TypeScript and runs via `node dist/server.js`.
# Requires DATABASE_URL (Postgres), OLLAMA_API_KEY_1..6, SHOPIFY_*, RESEND_API_KEY,
# MAIL_SMTP_*, SEAI_ENCRYPTION_KEY, SEAI_STAFF_API_KEY, CRON_SECRET at runtime.
# Falls back to disk-backed store (.seai-data) if DATABASE_URL is unset.

FROM node:20-alpine AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---
FROM deps AS build
WORKDIR /app
COPY . .
ENV DATABASE_URL=dummy_during_build
ENV SEAI_ENCRYPTION_KEY=dummy_during_build
RUN npx tsc -p tsconfig.server.json
RUN node scripts/copy-static.cjs

# --- Run ---
FROM base AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist dist
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
EXPOSE 3000
CMD ["node", "dist/server.js"]
