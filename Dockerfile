# ├── deps ──────────────────────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

# Prisma needs OpenSSL at generate/query time; Debian slim images don't ship it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# postinstall runs `prisma generate` — prisma CLI is a devDependency, so keep
# devDependencies for the install stage. The schema is copied so the postinstall
# generate has a schema to read. No DATABASE_URL is needed to generate the
# client (only `prisma migrate deploy` at runtime needs it).
COPY package.json package-lock.json ./
COPY prisma/ ./prisma/
RUN npm ci

# ├── build ─────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# OpenSSL for `prisma generate` in this stage too.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Public API key consumed by next.config-independent code and INNGEST event
# registration. Inngest is optional at build time.
ARG PUBLIC_INTAKE_KEY=dev-placeholder
ENV PUBLIC_INTAKE_KEY=$PUBLIC_INTAKE_KEY

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Standalone output (output: "standalone" in next.config.ts). Migrations are
# deliberately NOT run here (the package.json "build" script includes
# `prisma migrate deploy`, which needs DATABASE_URL/DIRECT_URL at build time).
# Use next build directly — schema migrations run in the CMD at container start
# where a runtime DATABASE_URL with DDL rights is the only requirement.
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
ENV AUTH_SECRET="dummy-secret"
ENV AUTH_URL="http://localhost:3000"
ENV PUBLIC_INTAKE_KEY="build-validation-key-32-chars-long"
RUN npx prisma generate && npx next build

# ├── runner ────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Standalone server + its minified .next output.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Schema + migrations for the runtime `prisma migrate deploy` (CMD) and for the
# Prisma query engine's schema reference. Seed scripts are NOT production
# artifacts and are intentionally excluded.
COPY --from=build /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build /app/prisma/migrations ./prisma/migrations

# Prisma (@prisma/client runtime + generated client + query engine) and argon2
# are server-external packages that must be present at runtime. Copy the full
# node_modules to keep the engine resolution reliable.
COPY --from=build /app/node_modules ./node_modules

# OpenSSL for the Prisma query engine + `prisma migrate deploy` at startup.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 nextjs \
  && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 8080

# Apply schema migrations once, then boot the standalone server.
# NOTE: with min-instances=1 (single Cloud Run instance) this is safe; if you
# ever scale to multiple instances, run `prisma migrate deploy` as a separate
# one-off job instead of per-container startup.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
