FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json ./

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @actalk/inkos-core build
RUN pnpm --filter @actalk/inkos-studio build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable && mkdir -p /data/inkos

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./

EXPOSE 4567

CMD ["node", "packages/studio/dist/api/index.js", "/data/inkos"]
