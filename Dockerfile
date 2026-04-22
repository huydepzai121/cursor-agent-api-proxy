FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:20-slim
WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist

ENV PORT=4646
EXPOSE 4646

CMD ["node", "dist/server/standalone.js", "run"]
