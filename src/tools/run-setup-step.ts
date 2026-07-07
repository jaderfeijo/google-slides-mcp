import { z } from "zod";

import { STEP_IDS } from "../setup/types.js";
import type { ToolDefinition } from "./register.js";

const inputSchema = {
	step: z
		.enum(STEP_IDS)
		.optional()
		.describe(
			"Named step to run — re-runs are allowed for recovery (e.g. " +
				"recreating a deleted OAuth client). Omit to run the first " +
				"incomplete step.",
		),
	projectId: z
		.string()
		.optional()
		.describe(
			"project_provisioning: reuse this existing Google Cloud project " +
				"instead of creating a new one",
		),
	installGcloud: z
		.boolean()
		.optional()
		.describe(
			"preflight: the user consented to running the Homebrew install of " +
				"the Google Cloud SDK",
		),
	clientJsonPath: z
		.string()
		.optional()
		.describe(
			"console_client: absolute path to the downloaded client_secret_*.json",
		),
	clientJsonContents: z
		.string()
		.optional()
		.describe(
			"console_client: the raw JSON contents pasted by the user " +
				"(preferred over a path when available)",
		),
	confirmDeleteFile: z
		.boolean()
		.optional()
		.describe(
			"console_client: the user confirmed deleting the plaintext client " +
				"JSON file (true) or explicitly chose to keep it (false)",
		),
	tier: z
		.enum(["core", "extended"])
		.optional()
		.describe(
			"first_account_auth: scope tier for the first account " +
				"(default core; extended adds broad Drive + Sheets read access)",
		),
};

export const runSetupStep: ToolDefinition<typeof inputSchema> = {
	name: "run_setup_step",
	description:
		"Execute the next (or a named) one-time setup step and return a " +
		"structured result: what happened, every command that ran (show these " +
		"to the user), and exactly what to tell or ask the user next. A " +
		"'failed' result is conversational — relay its instructions and " +
		"alternatives rather than treating it as an error. Ask the user " +
		"before steps that open a browser, create cloud resources, or " +
		"install software.",
	inputSchema,
	async handler(deps, args) {
		return deps.setup.run(args);
	},
};
