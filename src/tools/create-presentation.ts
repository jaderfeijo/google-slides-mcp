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
	async handler(deps, args) {
		const token = await deps.auth.getAccessToken();
		const client = deps.slides(token);
		const { data } = await client.presentations.create({
			requestBody: {
				title: args.title,
				...(args.locale ? { locale: args.locale } : {}),
			},
		});
		return {
			presentationId: data.presentationId,
			revisionId: data.revisionId,
			title: data.title,
			url: `https://docs.google.com/presentation/d/${data.presentationId}/edit`,
		};
	},
};
