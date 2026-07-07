# slides-mcp — native runtime, Docker CI (PRD §3, §8)

.PHONY: dev build typecheck test test-mac bundle ci clean

dev: build
	node dist/index.js

build:
	npm run build

typecheck:
	npm run typecheck

test:
	npm test

# Includes the macOS Keychain integration tests (real login keychain).
test-mac:
	npm run test:mac

bundle: build
	./scripts/build-mcpb.sh

# Canonical build — identical to what runs in Docker CI.
ci:
	docker compose run --rm ci

clean:
	rm -rf dist bundle out
