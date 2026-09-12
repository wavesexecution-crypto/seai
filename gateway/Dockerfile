# syntax=docker/dockerfile:1
# Multi-stage build: compile TypeScript, then run a minimal production image.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run app as non-root user (node:20-alpine ships a `node` user).
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]