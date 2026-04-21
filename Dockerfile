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

# Install Cursor CLI (installs to ~/.local/bin)
ENV PATH="/root/.local/bin:${PATH}"
RUN apt-get update && apt-get install -y curl && \
    curl https://cursor.com/install -fsS | bash && \
    apt-get purge -y curl && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist

ENV PORT=4646
EXPOSE 4646

CMD ["node", "dist/server/standalone.js", "run"]
