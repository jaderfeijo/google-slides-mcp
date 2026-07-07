#!/bin/bash
# Assemble the .mcpb bundle (PRD §8): compiled server + production
# node_modules + manifest, zipped by the mcpb CLI, with a SHA-256 checksum.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
ARTEFACT="out/slides-mcp-${VERSION}.mcpb"

rm -rf bundle out
mkdir -p bundle out

npm run build

cp manifest.json package.json package-lock.json bundle/
cp -R dist bundle/dist

# Fresh production-only node_modules — never the dev tree.
(cd bundle && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

npx mcpb validate bundle/manifest.json
npx mcpb pack bundle "$ARTEFACT"

shasum -a 256 "$ARTEFACT" | tee out/checksums.txt
