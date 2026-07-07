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
		"Slides request surface in one tool. Returns the per-request replies, " +
		"every affected objectId, and the deck's new revisionId for safe " +
		"chaining.",
	inputSchema,
	async handler(deps, args) {
		const token = await deps.auth.getAccessToken();
		const client = deps.slides(token);
		const { data } = await client.presentations.batchUpdate({
			presentationId: args.presentationId,
			requestBody: {
				requests: args.requests,
				...(args.requiredRevisionId
					? { writeControl: { requiredRevisionId: args.requiredRevisionId } }
					: {}),
			},
		});
		return {
			presentationId: data.presentationId,
			replies: data.replies ?? [],
			objectIds: collectObjectIds(data.replies ?? []),
			revisionId: data.writeControl?.requiredRevisionId,
		};
	},
};

/** Pulls every objectId out of the reply tree (PRD §7.4: write tools return
 * affected object IDs so Claude can chain edits safely). */
function collectObjectIds(value: unknown, found: string[] = []): string[] {
	if (Array.isArray(value)) {
		for (const item of value) collectObjectIds(item, found);
	} else if (value && typeof value === "object") {
		for (const [key, entry] of Object.entries(value)) {
			if (key === "objectId" && typeof entry === "string") {
				found.push(entry);
			} else {
				collectObjectIds(entry, found);
			}
		}
	}
	return found;
}
