# slides-mcp — entry point for common project actions. Run `make` to list them.

TIER ?= core

.PHONY: help deps build run inspect test test-mac auth-import auth-login auth-status auth-remove bundle ci clean

help: ## list available targets
	@awk -F':.*## ' '/^[a-z-]+:.*## / { printf "  make %-14s %s\n", $$1, $$2 }' Makefile

deps:
	@[ -d node_modules ] || npm ci

build: deps ## compile TypeScript to dist/
	npm run build

run: build ## run the MCP server on stdio (Ctrl-C to stop)
	node dist/index.js

inspect: build ## list the server's tools via MCP Inspector
	npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

test: deps ## unit tests (portable; Keychain suite self-skips)
	npm test

test-mac: deps ## all tests incl. real-Keychain integration (macOS only)
	npm run test:mac

auth-import: build ## import an OAuth client JSON: make auth-import FILE=path/to/client_secret.json
	@test -n "$(FILE)" || { echo "usage: make auth-import FILE=path/to/client_secret.json"; exit 1; }
	node dist/cli.js auth import "$(FILE)"

auth-login: build ## sign in a Google account (TIER=core|extended)
	node dist/cli.js auth login --tier $(TIER)

auth-status: build ## show configured client and account
	node dist/cli.js auth status

auth-remove: build ## revoke and remove an account: make auth-remove [EMAIL=a@b.com]
	node dist/cli.js auth remove $(EMAIL)

bundle: build ## build the installable .mcpb into out/
	./scripts/build-mcpb.sh

ci: ## canonical build in Docker (typecheck, tests, bundle)
	docker compose run --rm ci

clean: ## remove build artefacts
	rm -rf dist bundle out

.DEFAULT_GOAL := help
