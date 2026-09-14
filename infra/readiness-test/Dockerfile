FROM node:22-bookworm-slim
WORKDIR /workspace
ENV CI=true PNPM_HOME=/opt/pnpm PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
ENV PATH=/opt/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
RUN pnpm install --frozen-lockfile && pnpm exec playwright install --with-deps chromium
COPY . .
RUN test ! -e .env && pnpm --filter @hometown/domain build && pnpm --filter @hometown/api-contracts build
ENTRYPOINT ["node", "infra/readiness-test/run.mjs"]
