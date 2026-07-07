import {
	SCOPES_EXTENDED,
	SERVICE_CLIENT,
	consoleAuthUrl,
} from "../../constants.js";
import { importClientJson } from "../client-import.js";
import type {
	RunStepInputs,
	SetupState,
	SetupStep,
	StepContext,
	StepResult,
} from "../types.js";

const IMPORT_INPUTS: Record<string, string> = {
	clientJsonContents:
		"the raw JSON contents of the downloaded client_secret_*.json, pasted " +
		"by the user (preferred)",
	clientJsonPath: "absolute path to the downloaded client_secret_*.json",
	confirmDeleteFile:
		"after a path import: true to delete the plaintext file, false to keep it",
};

/** Step 4 (PRD §5.1): the only manual part of setup. Google has no public
 * API for creating standard Desktop OAuth clients, so phase A returns deep
 * links + a checklist for Claude to relay; phase B imports the downloaded
 * client JSON (paste-first — Downloads scanning would trip macOS TCC
 * consent, PRD §9) and removes the plaintext with the user's consent. */
export const consoleClient: SetupStep = {
	id: "console_client",
	title: "Configure the consent screen and create the OAuth client",

	async isComplete(ctx, state) {
		return (
			(await ctx.keychain.get(SERVICE_CLIENT)) !== null &&
			!state.pendingClientFileDelete
		);
	},

	pendingInstructions: () =>
		"The next step is the only manual part: two short visits to the " +
		"Google console (consent screen, then OAuth client). Offer to walk " +
		"the user through it item by item; when they've downloaded the client " +
		"JSON, ask them to paste its contents or give its file path.",

	async run(ctx, state, inputs): Promise<StepResult> {
		const importing =
			inputs.clientJsonContents !== undefined ||
			inputs.clientJsonPath !== undefined ||
			inputs.confirmDeleteFile !== undefined;
		if (importing) return importPhase(ctx, state, inputs);
		return guidancePhase(state);
	},
};

function guidancePhase(state: SetupState): StepResult {
	const projectId = state.projectId;
	const scopes = SCOPES_EXTENDED.map((s) => `   ${s}`).join("\n");
	return {
		step: "console_client",
		status: "action_required",
		detail: "manual console configuration required",
		instructions:
			"Google provides no API for this part, so the user configures two " +
			"console pages by hand — relay the checklist (one item at a time if " +
			"they prefer), then ask them to paste the downloaded JSON contents " +
			"or give its file path. Reassure them about the unverified-app " +
			"notice: they are approving their own private app.",
		links: [
			{ label: "Consent screen overview", url: consoleAuthUrl("overview", projectId) },
			{ label: "Branding", url: consoleAuthUrl("branding", projectId) },
			{ label: "Audience (publishing status)", url: consoleAuthUrl("audience", projectId) },
			{ label: "Data access (scopes)", url: consoleAuthUrl("scopes", projectId) },
			{ label: "Create the OAuth client", url: consoleAuthUrl("clients/create", projectId) },
		],
		checklist: [
			'Branding: set the app name (suggestion: "Slides MCP (personal)") and your email addresses.',
			"Audience: choose user type External (Internal on Workspace also works and removes the unverified-app notice entirely).",
			`Data access: add ALL of these scopes (both tiers, so upgrading later never needs console changes):\n${scopes}`,
			"Audience: set publishing status to In production — in Testing, Google expires sign-ins after 7 days, which breaks the tool.",
			"If Google shows an unverified-app notice, acknowledge it — you are approving your own private app; nobody else can use this client.",
			"Clients: Create Client → application type Desktop app → Create → Download JSON.",
			"Give the downloaded JSON to Claude: paste its contents, or provide the file path.",
		],
		inputs: IMPORT_INPUTS,
	};
}

async function importPhase(
	ctx: StepContext,
	state: SetupState,
	inputs: RunStepInputs,
): Promise<StepResult> {
	// Resolve a pending plaintext-deletion consent round-trip first.
	if (state.pendingClientFileDelete && inputs.confirmDeleteFile !== undefined) {
		const path = state.pendingClientFileDelete;
		delete state.pendingClientFileDelete;
		if (inputs.confirmDeleteFile) {
			await ctx.fs.unlink(path);
			return completed(
				`plaintext client JSON deleted (${path})`,
				"Tell the user the client is safely in the Keychain and the " +
					"plaintext file is deleted. Next: connect their first Google " +
					"account (the browser will open once they're ready).",
			);
		}
		return completed(
			`client imported; user kept the plaintext file at ${path}`,
			"The user chose to keep the plaintext client file — note that the " +
				"Keychain copy is the one that matters and recommend deleting the " +
				"file later. Next: connect their first Google account.",
		);
	}

	let raw: string;
	let sourcePath: string | undefined;
	if (inputs.clientJsonContents !== undefined) {
		raw = inputs.clientJsonContents;
	} else if (inputs.clientJsonPath !== undefined) {
		sourcePath = inputs.clientJsonPath;
		try {
			raw = await ctx.fs.readFile(sourcePath);
		} catch (err) {
			return failed(
				`cannot read ${sourcePath}`,
				`The file could not be read (${err instanceof Error ? err.message : err}). ` +
					"Ask the user to check the path, or to paste the JSON contents instead.",
			);
		}
	} else {
		return failed(
			"no pending file-deletion decision",
			"There is nothing to confirm — provide the client JSON first " +
				"(contents or path).",
		);
	}

	const result = await importClientJson(ctx.keychain, raw);
	if (!result.ok) {
		return failed(
			"client JSON rejected",
			`The provided JSON was rejected: ${result.reason}. Ask the user to ` +
				"re-download the Desktop-app client JSON and try again.",
		);
	}

	if (sourcePath) {
		if (inputs.confirmDeleteFile) {
			await ctx.fs.unlink(sourcePath);
			return completed(
				`client ${result.config.clientId} imported; plaintext deleted`,
				"Tell the user the client is in the Keychain and the plaintext " +
					"file is deleted. Next: connect their first Google account.",
			);
		}
		state.pendingClientFileDelete = sourcePath;
		return {
			step: "console_client",
			status: "action_required",
			detail: `client ${result.config.clientId} imported; plaintext file remains`,
			instructions:
				"The client is now safely in the macOS Keychain. Ask the user to " +
				`confirm deleting the plaintext file at ${sourcePath} (recommended), ` +
				"then call this step with confirmDeleteFile: true — or false to keep it.",
			inputs: {
				confirmDeleteFile:
					"true to delete the plaintext client JSON, false to keep it",
			},
		};
	}

	return completed(
		`client ${result.config.clientId} imported from pasted contents`,
		"Tell the user the client is in the Keychain. If the JSON file is " +
			"still in their Downloads folder, recommend deleting it. Next: " +
			"connect their first Google account.",
	);
}

const completed = (detail: string, instructions: string): StepResult => ({
	step: "console_client",
	status: "completed",
	detail,
	instructions,
});

const failed = (detail: string, instructions: string): StepResult => ({
	step: "console_client",
	status: "failed",
	detail,
	instructions,
	inputs: IMPORT_INPUTS,
});
