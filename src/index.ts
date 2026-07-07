#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AuthManager } from "./auth/manager.js";
import { SERVICE_META } from "./constants.js";
import { SecurityCliKeychain } from "./keychain/security-cli.js";
import { createSlidesClient } from "./google/slides-client.js";
import { buildDiagnostics, buildSetupEngine } from "./setup/context.js";
import { registerTools, type AnyToolDefinition } from "./tools/register.js";
import { createPresentation } from "./tools/create-presentation.js";
import { getPresentation } from "./tools/get-presentation.js";
import { batchUpdate } from "./tools/batch-update.js";
import { getSetupStatus } from "./tools/get-setup-status.js";
import { runSetupStep } from "./tools/run-setup-step.js";
import { runDiagnostics } from "./tools/run-diagnostics.js";

// Only implemented tools are registered — Claude never sees dead tools.
// Grows as milestone issues land (#29-38).
const TOOLS: ReadonlyArray<AnyToolDefinition> = [
	createPresentation,
	getPresentation,
	batchUpdate,
	getSetupStatus,
	runSetupStep,
	runDiagnostics,
];

/**
 * Startup Keychain probe (PRD §9 "Keychain access denied after app update"):
 * detection only — the server never exits over it. Every tool call resolves
 * credentials independently, so a denied Keychain surfaces per call as the
 * structured KEYCHAIN_ACCESS_DENIED fix inside the conversation.
 */
async function probeKeychain(keychain: SecurityCliKeychain): Promise<void> {
	try {
		await keychain.get(SERVICE_META);
		console.error("keychain probe: ok");
	} catch (err) {
		console.error(
			"keychain probe: access denied — tool calls will return the fix:",
			err instanceof Error ? err.message : err,
		);
	}
}

async function main(): Promise<void> {
	const keychain = new SecurityCliKeychain();
	const deps = {
		keychain,
		auth: new AuthManager(keychain),
		slides: createSlidesClient,
		setup: buildSetupEngine(keychain, createSlidesClient),
		diagnostics: buildDiagnostics(keychain),
	};

	const server = new McpServer({ name: "slides-mcp", version: "0.1.0" });
	registerTools(server, deps, TOOLS);

	await probeKeychain(keychain);

	// stdout is the MCP channel; all logging goes to stderr.
	await server.connect(new StdioServerTransport());
	console.error("slides-mcp ready (stdio)");
}

main().catch((err) => {
	console.error("slides-mcp fatal:", err);
	process.exit(1);
});
