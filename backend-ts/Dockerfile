# margixindia TS Backend — Railway Dockerfile
FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production=false

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Railway sets PORT via env var
CMD ["node", "dist/index.js"]
