sudo apt-get update -qq

# libasound2 package name differs between Ubuntu versions
ALSA_PKG="libasound2"
if ! apt-cache show "$ALSA_PKG" >/dev/null 2>&1; then
  ALSA_PKG="libasound2t64"
fi

sudo apt-get install -y -qq \
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
  "$ALSA_PKG" \
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
  fonts-tlwg-loma-otf
