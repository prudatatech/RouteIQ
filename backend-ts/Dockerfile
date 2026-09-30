# margixindia TS Backend — production image (Railway, Azure Container Apps)
FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production=false

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Drop dev dependencies from the final image
RUN npm prune --omit=dev
ENV NODE_ENV=production

# The platform sets PORT (default 8000); the app listens on it on 0.0.0.0
CMD ["node", "dist/index.js"]
