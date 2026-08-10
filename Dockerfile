# Toque container image — Node.js 26 + headless browser deps for CloakBrowser
# Multi-stage build: deps layer cached separately from app code.
FROM node:26-slim AS base

# Install system dependencies required by CloakBrowser/Chromium in a single layer.
# Fonts are required for canvas emoji rendering hashes (anti-bot detection).
# Uses t64-suffixed packages for Ubuntu 24.04+ (Noble) compatibility.
RUN apt-get update && apt-get install -y --no-install-recommends \
  libatk1.0-0t64 \
  libatk-bridge2.0-0t64 \
  libcups2t64 \
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
  libasound2t64 \
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
  tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Pre-download the CloakBrowser stealth Chromium binary during build so the
# first request doesn't pay the download cost (~200MB).
# CLOAKBROWSER_SUPPRESS_FONT_WARNING silences the incomplete font set notice.
ENV CLOAKBROWSER_SUPPRESS_FONT_WARNING=1
RUN npx cloakbrowser install || true

# --- App layer ---
FROM base AS app

WORKDIR /app

# Copy application code (layer cached separately from deps above)
COPY . .

# Create non-root user and fix permissions for cloakbrowser.
# The cloakbrowser Chromium binary was pre-downloaded to /root/.cloakbrowser
# during the build stage. We need to copy it to the toque user's home dir
# and fix ownership so the non-root user can access it.
RUN groupadd -r toque && useradd -r -g toque -m -s /bin/bash toque \
  && cp -r /root/.cloakbrowser /home/toque/.cloakbrowser 2>/dev/null || true \
  && chown -R toque:toque /app /home/toque
USER toque

# The container exposes an HTTP server on PORT (default 8080)
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

# Use tini as PID 1 for proper signal handling (graceful shutdown)
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/server.js"]
