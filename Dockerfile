# AgentKernel — Multi-Agent Traffic Control Layer
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build || true

# Runtime config
ENV KERNEL_MODE=orchestrator \
    MAX_CONCURRENT_AGENTS=50 \
    LOG_LEVEL=info \
    PORT=8080

EXPOSE 8080 9090 3000

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/kernel-cli.js", "status"]
