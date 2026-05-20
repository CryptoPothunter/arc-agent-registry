FROM node:18-alpine

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

EXPOSE 3000

CMD ["npm", "start"]
