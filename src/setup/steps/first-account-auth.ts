import type { ClientConfig } from "../../auth/types.js";
import { SERVICE_CLIENT, SERVICE_META } from "../../constants.js";
import { translateGoogleError } from "../../errors.js";
import { trashFile } from "../../google/drive-rest.js";
import type { SetupStep, StepResult } from "../types.js";

const SMOKE_TITLE = "slides-mcp setup verification — safe to delete";

/** Step 5 (PRD §5.1): PKCE for the first Slides account, verified with a
 * live create → get → trash round trip. */
export const firstAccountAuth: SetupStep = {
	id: "first_account_auth",
	title: "Connect your first Google account",

	async isComplete(ctx) {
		return (await ctx.keychain.get(SERVICE_META)) !== null;
	},

	pendingInstructions: () =>
		"The final step connects the Google account whose Slides will be " +
		"edited (this can differ from the provisioning account). Explain the " +
		"tiers — core: full Slides access plus only files the tool creates; " +
		"extended: adds broad Drive access and Sheets reading for templates " +
		"and chart linking (changeable later). The browser will open for " +
		"Google sign-in; Google shows an unverified-app notice for the " +
		"user's own app — Advanced → continue is expected. Get their " +
		"go-ahead first.",

	async run(ctx, state, inputs): Promise<StepResult> {
		const rawClient = await ctx.keychain.get(SERVICE_CLIENT);
		if (!rawClient) {
			return {
				step: "first_account_auth",
				status: "failed",
				detail: "no OAuth client in the Keychain",
				instructions:
					"The OAuth client is missing — run the console_client step first.",
			};
		}
		const tier = inputs.tier ?? "core";

		let email: string;
		try {
			const record = await ctx.runAuthFlow(
				JSON.parse(rawClient) as ClientConfig,
				ctx.keychain,
				{ tier },
			);
			email = record.email;
		} catch (err) {
			const translated = translateGoogleError(err);
			return {
				step: "first_account_auth",
				status: "failed",
				detail: `sign-in failed: ${translated.code}`,
				instructions:
					`The Google sign-in did not complete (${translated.message}). ` +
					"Ask the user to try again — the browser window may have been " +
					"closed, or consent was declined.",
			};
		}

		// Live smoke test (PRD §5.1 step 5): create → get → trash.
		try {
			const token = await ctx.getAccessToken(email);
			const slides = ctx.slides(token);
			const { data: created } = await slides.presentations.create({
				requestBody: { title: SMOKE_TITLE },
			});
			const presentationId = created.presentationId ?? "";
			await slides.presentations.get({ presentationId });
			await trashFile(ctx.fetch, token, presentationId);
		} catch (err) {
			const translated = translateGoogleError(err);
			return {
				step: "first_account_auth",
				status: "failed",
				detail: `smoke test failed: ${translated.code}`,
				instructions:
					translated.code === "API_NOT_ENABLED"
						? `${email} is signed in, but the verification call failed ` +
							"because an API is not enabled on the project — re-run the " +
							"project_provisioning step, then run this step again."
						: `${email} is signed in, but the verification call failed: ` +
							`${translated.message}. ${translated.hint ?? ""} Fix the ` +
							"cause and re-run this step.",
				alternatives:
					translated.code === "API_NOT_ENABLED"
						? [
								{
									id: "reenable_apis",
									description: "Re-run API enablement on the project.",
									nextCall: { step: "project_provisioning" },
								},
							]
						: undefined,
			};
		}

		return {
			step: "first_account_auth",
			status: "completed",
			detail: `${email} connected (${tier} tier); smoke test passed`,
			instructions:
				`Setup is complete. Tell the user ${email} is connected on the ` +
				`${tier} tier and everything was verified live (a throwaway deck ` +
				"was created and immediately trashed). They can now just ask for " +
				"slides — and add more accounts or register templates any time.",
			setupComplete: {
				account: email,
				tier,
				...(state.projectId ? { projectId: state.projectId } : {}),
			},
		};
	},
};
