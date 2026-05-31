# Multi-stage Dockerfile for the fumadocs site.
# Targets Coolify deployment with Next standalone output.
#
# Build context must be the REPO ROOT, not apps/docs, because the docs app
# depends on `@10x-media/tsconfig` via the workspace and pnpm needs the
# full pnpm-lock.yaml to resolve.
#
# Build:   docker build -f apps/docs/Dockerfile -t 10x-media-docs .
# Run:     docker run --rm -p 3000:3000 10x-media-docs

ARG NODE_VERSION=20-alpine
ARG PNPM_VERSION=10.14.0

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
RUN apk add --no-cache libc6-compat \
	&& corepack enable \
	&& corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/docs/package.json ./apps/docs/
COPY config/typescript/package.json ./config/typescript/
RUN pnpm install --frozen-lockfile --filter @10x-media/docs...

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/docs/node_modules ./apps/docs/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY config ./config
COPY apps/docs ./apps/docs
RUN pnpm --filter @10x-media/docs build

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
	&& adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/docs/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/docs/.next/static ./apps/docs/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/docs/server.js"]
