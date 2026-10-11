FROM node:22-alpine
WORKDIR /app

COPY package.json ./
COPY packages ./packages

# Build inside the image: engine first, then server (see root package.json "build").
RUN npm install --no-audit --no-fund \
 && npm run build \
 && npm prune --omit=dev

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8099 \
    INGRESS_ONLY=1

# SUPERVISOR_TOKEN is injected by the Supervisor (homeassistant_api: true).
CMD ["node", "packages/server/dist/main.js"]
