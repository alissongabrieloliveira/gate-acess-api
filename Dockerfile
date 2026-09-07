# Build de produção da API. Não inclui dev tools (jest, supertest, etc.) —
# essas continuam só no host, rodadas via `npm test`, não dentro da imagem.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 3333
CMD ["node", "src/server.js"]
