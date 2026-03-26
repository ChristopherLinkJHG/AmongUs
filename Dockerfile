FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=2567

EXPOSE 2567

CMD ["npm", "run", "server"]
