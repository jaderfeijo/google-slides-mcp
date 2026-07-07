import type { ToolDefinition } from "./register.js";

const inputSchema = {};

export const getSetupStatus: ToolDefinition<typeof inputSchema> = {
	name: "get_setup_status",
	description:
		"Report the one-time setup state: which steps are complete, which is " +
		"current, and the instructions to relay to the user for it. Call this " +
		"whenever a tool returns setup_required, then guide the user through " +
		"the remaining steps with run_setup_step, narrating each one. Always " +
		"ask the user before actions that open a browser, create Google Cloud " +
		"resources, or install software. Setup is resumable at any time.",
	inputSchema,
	async handler(deps) {
		return deps.setup.status();
	},
};
