# Use the official Node.js 20-slim image.
# https://hub.docker.com/_/node
FROM node:20-slim

WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "server.js"]
