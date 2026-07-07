import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape, objectOutputType, ZodTypeAny } from "zod";

import { AuthManager, NotConfiguredError } from "../auth/manager.js";
import type { KeychainStore } from "../keychain/store.js";
import type { SlidesClientFactory } from "../google/slides-client.js";
import { translateGoogleError } from "../errors.js";
import { setupRequired } from "../unconfigured.js";

/** Dependencies injected into every tool handler (fakes in tests). */
export interface ToolDeps {
	keychain: KeychainStore;
	auth: AuthManager;
	slides: SlidesClientFactory;
}

export interface ToolDefinition<Shape extends ZodRawShape> {
	name: string;
	description: string;
	inputSchema: Shape;
	handler: (
		deps: ToolDeps,
		args: objectOutputType<Shape, ZodTypeAny>,
	) => Promise<unknown>;
}

/** Erased form for heterogeneous tool lists (registration only). */
export interface AnyToolDefinition {
	name: string;
	description: string;
	inputSchema: ZodRawShape;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	handler: (deps: ToolDeps, args: any) => Promise<unknown>;
}

const asText = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/**
 * The stateless-handler contract in one place (PRD §3, §7.4, §9):
 * unconfigured check → handler → structured error translation.
 */
export function registerTools(
	server: McpServer,
	deps: ToolDeps,
	tools: ReadonlyArray<AnyToolDefinition>,
): void {
	for (const tool of tools) {
		server.registerTool(
			tool.name,
			{ description: tool.description, inputSchema: tool.inputSchema },
			async (args: Record<string, unknown>): Promise<CallToolResult> => {
				try {
					return asText(await tool.handler(deps, args));
				} catch (err) {
					if (err instanceof NotConfiguredError) {
						return asText(setupRequired(err.message));
					}
					const translated = translateGoogleError(err);
					return { ...asText(translated), isError: true };
				}
			},
		);
	}
}
