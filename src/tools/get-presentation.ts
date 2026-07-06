import { z } from "zod";
import type { ToolDefinition } from "./register.js";

const inputSchema = {
	presentationId: z.string().describe("ID of the presentation to fetch"),
	fields: z
		.string()
		.optional()
		.describe(
			"Optional Google API field mask limiting the response, e.g. " +
				"\"slides.objectId,title,revisionId\". Use it to keep large decks " +
				"token-viable.",
		),
};

export const getPresentation: ToolDefinition<typeof inputSchema> = {
	name: "get_presentation",
	description:
		"Fetch a presentation's full JSON (optionally reduced by a fields " +
		"mask). A compact summary mode is planned; until then prefer a fields " +
		"mask for large decks.",
	inputSchema,
	async handler(_deps, _args) {
		throw new Error("Not implemented yet — tracked in issue #15");
	},
};
