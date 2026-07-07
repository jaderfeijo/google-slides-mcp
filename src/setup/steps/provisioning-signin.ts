import { GcloudCli } from "../gcloud.js";
import type { SetupStep, StepResult } from "../types.js";

/** Step 2 (PRD §5.1): sign into gcloud for provisioning. This identity only
 * creates infrastructure and is independent of the Slides accounts. */
export const provisioningSignin: SetupStep = {
	id: "provisioning_signin",
	title: "Sign into Google Cloud for provisioning",

	async isComplete(ctx, state) {
		if (!state.gcloudPath) return false;
		const gcloud = new GcloudCli(ctx.exec, state.gcloudPath);
		return Boolean(await gcloud.activeAccount());
	},

	pendingInstructions: () =>
		"Explain before the browser opens: this sign-in is only used to " +
		"create Google Cloud infrastructure (a project and an OAuth client). " +
		"It can be any Google account and is separate from the account whose " +
		"Slides will be edited — that one is added in the final step.",

	async run(ctx, state): Promise<StepResult> {
		if (!state.gcloudPath) {
			return {
				step: "provisioning_signin",
				status: "failed",
				detail: "gcloud path unknown",
				instructions:
					"Preflight has not found gcloud yet — run the preflight step first.",
			};
		}
		const gcloud = new GcloudCli(ctx.exec, state.gcloudPath);

		let account = await gcloud.activeAccount();
		if (!account) {
			const login = await gcloud.login();
			if (login.timedOut || login.exitCode !== 0) {
				return {
					step: "provisioning_signin",
					status: "failed",
					detail: login.timedOut
						? "gcloud auth login timed out after 5 minutes"
						: `gcloud auth login exited ${login.exitCode}`,
					instructions:
						"The Google Cloud sign-in did not complete. Ask the user to " +
						"try again (the browser window may have been closed), then " +
						"re-run this step.",
					commandsRun: gcloud.commands,
				};
			}
			account = await gcloud.activeAccount();
		}

		if (!account) {
			return {
				step: "provisioning_signin",
				status: "failed",
				detail: "no active gcloud account after login",
				instructions:
					"gcloud reports no active account even after sign-in. Show the " +
					"user the command output and re-run this step.",
				commandsRun: gcloud.commands,
			};
		}

		state.provisioningAccount = account;
		return {
			step: "provisioning_signin",
			status: "completed",
			detail: `signed in as ${account}`,
			instructions:
				`Tell the user they're signed into Google Cloud as ${account}. ` +
				"Next, a dedicated project is created (free — no billing account " +
				"needed) and the Slides, Drive, and Sheets APIs are enabled on it. " +
				"Get their go-ahead, or ask if they'd rather reuse an existing " +
				"project (provide projectId).",
			commandsRun: gcloud.commands,
		};
	},
};
