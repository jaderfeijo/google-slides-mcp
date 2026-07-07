import { z } from "zod";

import type { ToolDefinition } from "./register.js";

const inputSchema = {
	account: z
		.string()
		.optional()
		.describe(
			"Limit the refresh-token check to this account email (default: the " +
				"default account)",
		),
};

export const runDiagnostics: ToolDefinition<typeof inputSchema> = {
	name: "run_diagnostics",
	description:
		"Health-check the installation: Keychain access, OAuth client, " +
		"refresh-token validity, API enablement (live probes), the " +
		"consent-screen-in-Testing signature, and the template registry. " +
		"Every failing check carries a named fix — relay it, and where it " +
		"includes a nextCall, offer to run that tool for the user. This is " +
		"the first thing to run when something misbehaves.",
	inputSchema,
	async handler(deps, args) {
		return deps.diagnostics.run(args.account);
	},
};
