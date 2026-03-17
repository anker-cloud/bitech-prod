FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first so this layer is cached between builds
COPY package*.json ./

# Install all dependencies (devDependencies are needed for the build step)
RUN npm ci

# Copy the full source tree
COPY . .

# Build: compiles Vite frontend + esbuild server bundle → dist/
RUN npm run build

# ── Production image ────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy built artefacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production dependencies only (needed for externalized packages
# such as AWS SDK that are not bundled by esbuild)
RUN npm ci --omit=dev

# The container is used as an artefact carrier by the CodeDeploy deploy script:
#   docker cp dc4ai-extract:/app/dist       /opt/dc4ai/dist
#   docker cp dc4ai-extract:/app/package.json /opt/dc4ai/package.json
#   docker cp dc4ai-extract:/app/node_modules /opt/dc4ai/node_modules
# PM2 then starts the app on the EC2 host — not inside the container.
# A CMD is defined here so the image is also runnable directly if needed.
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
