FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY config ./config
COPY fixtures ./fixtures
COPY scripts ./scripts
COPY vitest.config.ts ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public
COPY config ./config
COPY fixtures ./fixtures
COPY scripts ./scripts
COPY .env.example ./.env.example
EXPOSE 3000
CMD ["node", "dist/server.js"]
