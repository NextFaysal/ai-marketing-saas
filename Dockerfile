# AI Marketing SaaS — one image for api / web / admin (Dokploy pack).
# The three services run the same image with different commands
# (see docker-compose.dokploy.yml). Prepared for the Dokploy guide
# in docs/deployment-dokploy.md.
FROM node:22-bookworm-slim AS build
# Prisma needs OpenSSL present to detect its engine platform on slim
# images (build-time generate + runtime migrate/query engine).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# The tenant + admin apps proxy /backend to the API at this internal
# address. It is a build-time ARG because Next.js may bake config
# rewrites at build time; the same value is also passed at runtime.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm -r build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
# Default command is the API; compose overrides per service.
CMD ["node", "apps/api/dist/main.js"]
