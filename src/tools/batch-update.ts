import { z } from "zod";
import type { ToolDefinition } from "./register.js";

const inputSchema = {
	presentationId: z.string().describe("ID of the presentation to modify"),
	requests: z
		.array(z.record(z.unknown()))
		.nonempty()
		.describe(
			"Array of Google Slides batchUpdate request objects, passed through " +
				"verbatim — every request type the Slides API supports is valid " +
				"here (createSlide, insertText, updatePageElementTransform, ...).",
		),
	requiredRevisionId: z
		.string()
		.optional()
		.describe(
			"Optimistic-concurrency guard: the call fails if the deck has " +
				"changed since this revisionId was read.",
		),
};

export const batchUpdate: ToolDefinition<typeof inputSchema> = {
	name: "batch_update",
	description:
		"Full passthrough of presentations.batchUpdate — the complete Google " +
		"Slides request surface in one tool. Returns the per-request replies " +
		"and the deck's new revisionId for safe chaining.",
	inputSchema,
	async handler(_deps, _args) {
		throw new Error("Not implemented yet — tracked in issue #15");
	},
};
