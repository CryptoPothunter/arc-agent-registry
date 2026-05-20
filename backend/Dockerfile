FROM node:18-alpine

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci --production

COPY backend/ ./

EXPOSE 3001

CMD ["node", "server.js"]
