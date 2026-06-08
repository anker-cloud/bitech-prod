#!/bin/bash
set -e
REGION=eu-central-1
ACCOUNT=072012508476
REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/dc4ai-production"

# Authenticate to ECR using the instance IAM role
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin \
  "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

# Pull latest image
docker pull $REPO:latest

# Extract built artefacts from image (dist + node_modules + package.json)
docker rm -f temp_dc4ai 2>/dev/null || true
docker create --name temp_dc4ai $REPO:latest
rm -rf /opt/dc4ai/dist /opt/dc4ai/node_modules
docker cp temp_dc4ai:/app/dist         /opt/dc4ai/dist
docker cp temp_dc4ai:/app/package.json /opt/dc4ai/package.json
docker cp temp_dc4ai:/app/node_modules /opt/dc4ai/node_modules
docker rm temp_dc4ai

# Start app with PM2 — set -a exports all env vars to child processes
set -a
source /etc/dc4ai.env
set +a
cd /opt/dc4ai
pm2 delete dc4ai 2>/dev/null || true
pm2 start dist/index.cjs --name dc4ai
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true
systemctl enable pm2-root 2>/dev/null || true
