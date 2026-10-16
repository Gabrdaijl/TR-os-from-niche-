FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
ENV HOST=0.0.0.0 PORT=8173
USER node
EXPOSE 8173
CMD ["node", "server.cjs"]
