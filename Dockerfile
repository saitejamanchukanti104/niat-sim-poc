# NIAT Embedded Lab POC. NOTE: not built in the environment where the POC was made.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl python3 python3-pip \
      gcc-arm-none-eabi libnewlib-arm-none-eabi gcc-avr avr-libc binutils-avr \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && pip3 install --break-system-packages unicorn pyyaml \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install
COPY . .
RUN node scripts/build-web.js
EXPOSE 8080
CMD ["node", "server/index.js"]
