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

# Self-check: the packed artefact must run on its own bundled node_modules.
EXTRACT_DIR=$(mktemp -d)
trap 'rm -rf "$EXTRACT_DIR"' EXIT
unzip -q "$ARTEFACT" -d "$EXTRACT_DIR"
node "$EXTRACT_DIR/dist/cli.js" >/dev/null 2>&1 \
	|| { echo "self-check failed: bundled cli.js did not run" >&2; exit 1; }
echo "self-check ok: bundled server runs from the extracted artefact"

# macOS ships shasum (perl); the Debian CI image ships sha256sum (coreutils).
if command -v shasum >/dev/null 2>&1; then
	shasum -a 256 "$ARTEFACT" | tee out/checksums.txt
else
	sha256sum "$ARTEFACT" | tee out/checksums.txt
fi
