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
	async handler(deps, args) {
		const token = await deps.auth.getAccessToken();
		const client = deps.slides(token);
		const { data } = await client.presentations.get({
			presentationId: args.presentationId,
			...(args.fields ? { fields: args.fields } : {}),
		});
		return data;
	},
};
