
FROM node:22-alpine AS build

WORKDIR /app

# Instala as dependências do projeto
COPY package*.json ./
RUN npm ci

# Copia os arquivos necessários para o desenvolvimento
COPY tsconfig.json ./
COPY src ./src

CMD ["npm", "run", "dev"]
