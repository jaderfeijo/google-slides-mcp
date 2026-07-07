import { z } from "zod";
import type { ToolDefinition } from "./register.js";

const inputSchema = {
	title: z.string().describe("Title of the new presentation"),
	locale: z
		.string()
		.optional()
		.describe("Optional locale, e.g. en-US (IETF BCP 47)"),
};

export const createPresentation: ToolDefinition<typeof inputSchema> = {
	name: "create_presentation",
	description:
		"Create a new, empty Google Slides presentation. Returns the new " +
		"presentationId, revisionId, and a URL for the user to open it.",
	inputSchema,
	async handler(_deps, _args) {
		throw new Error("Not implemented yet — tracked in issue #15");
	},
};
