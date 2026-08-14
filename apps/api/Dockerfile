FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages packages
COPY infra/mysql/migrations infra/mysql/migrations
RUN pnpm --filter @hometown/domain build && pnpm --filter @hometown/api-contracts build && pnpm --filter @hometown/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
RUN addgroup -S hometown && adduser -S hometown -G hometown
COPY --from=build --chown=hometown:hometown /workspace/node_modules ./node_modules
COPY --from=build --chown=hometown:hometown /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=hometown:hometown /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=hometown:hometown /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=hometown:hometown /workspace/packages ./packages
COPY --from=build --chown=hometown:hometown /workspace/infra/mysql/migrations ./infra/mysql/migrations
USER hometown
WORKDIR /workspace/apps/api
EXPOSE 3100
CMD ["node","dist/server.js"]

