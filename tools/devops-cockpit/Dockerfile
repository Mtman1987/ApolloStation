FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git jq python3 tar gzip xz-utils procps nano \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-6 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libxshmfence1 libxkbcommon0 libglib2.0-0 \
    libcairo2 libpango-1.0-0 libcups2 libdrm2 libxfixes3 fonts-liberation \
    fonts-noto-color-emoji \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm ci \
    && node scripts/setup-local-browser.mjs \
    && curl -fsSL https://hostless.cloud/install.sh | bash \
    && curl -sSfL https://get.tur.so/install.sh | bash

ENV PATH="/root/.turso/bin:/root/.local/bin:/usr/local/bin"
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "tools/devops-cockpit/server.mjs"]
