FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    RESTREAM_PROFILE_DIR=/var/lib/restream-profile \
    RESTREAM_PROFILE_VOLUME_MARKER=/var/lib/restream-profile/.restream-profile-volume \
    RESTREAM_AUTOMATION_ENABLED=false

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb ca-certificates fonts-liberation fonts-noto-color-emoji \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
      libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libnspr4 libnss3 \
      libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxrandr2 libxrender1 libxshmfence1 \
      libxss1 libxtst6 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt/restream-control
COPY services/restream-control/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY services/restream-control/src ./src
RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin restream && \
    mkdir -p /var/lib/restream-profile && \
    chown -R restream:restream /opt/restream-control /var/lib/restream-profile

USER restream
EXPOSE 3018
CMD ["node", "src/server.js"]
