#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AuthManager } from "./auth/manager.js";
import { SecurityCliKeychain } from "./keychain/security-cli.js";
import { createSlidesClient } from "./google/slides-client.js";
import { registerTools, type AnyToolDefinition } from "./tools/register.js";
import { createPresentation } from "./tools/create-presentation.js";
import { getPresentation } from "./tools/get-presentation.js";
import { batchUpdate } from "./tools/batch-update.js";

// Only implemented tools are registered — Claude never sees dead tools.
// Grows as milestone issues land (#15, #21-22, #27, #29-38).
const TOOLS: ReadonlyArray<AnyToolDefinition> = [
	createPresentation,
	getPresentation,
	batchUpdate,
];

async function main(): Promise<void> {
	const keychain = new SecurityCliKeychain();
	const deps = {
		keychain,
		auth: new AuthManager(keychain),
		slides: createSlidesClient,
	};

	const server = new McpServer({ name: "slides-mcp", version: "0.1.0" });
	registerTools(server, deps, TOOLS);

	// stdout is the MCP channel; all logging goes to stderr.
	await server.connect(new StdioServerTransport());
	console.error("slides-mcp ready (stdio)");
}

main().catch((err) => {
	console.error("slides-mcp fatal:", err);
	process.exit(1);
});
