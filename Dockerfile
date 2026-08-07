# Toque container image — Node.js + headless browser dependencies for CloakBrowser
FROM node:20-slim

# Install system dependencies required by CloakBrowser/Chromium in a single layer.
# Fonts are required for canvas emoji rendering hashes (anti-bot detection).
RUN apt-get update && apt-get install -y --no-install-recommends \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libdbus-1-3 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libnspr4 \
  libnss3 \
  libxfixes3 \
  libasound2 \
  libx11-xcb1 \
  libxcb1 \
  libxext6 \
  libxrender1 \
  libxtst6 \
  libxi6 \
  libxss1 \
  fonts-noto-color-emoji \
  fonts-freefont-ttf \
  fonts-unifont \
  fonts-ipafont-gothic \
  fonts-wqy-zenhei \
  fonts-tlwg-loma-otf \
  ca-certificates \
  curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Pre-download the CloakBrowser stealth Chromium binary during build so the
# first request doesn't pay the download cost (~200MB).
RUN npx cloakbrowser install || true

# The container exposes an HTTP server on PORT (default 8080)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
