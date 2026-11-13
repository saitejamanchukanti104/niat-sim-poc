#!/usr/bin/env bash
# One-time setup for the Codespace: compilers, Python engine deps, Node deps, UI bundle.
set -euxo pipefail
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  gcc-arm-none-eabi libnewlib-arm-none-eabi gcc-avr avr-libc binutils-avr python3-pip
sudo pip3 install --break-system-packages unicorn pyyaml
npm install --omit=dev
npm run build
