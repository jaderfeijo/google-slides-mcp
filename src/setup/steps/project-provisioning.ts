import { randomBytes } from "node:crypto";

import { PROJECT_ID_PREFIX } from "../../constants.js";
import { GcloudCli, type GcloudResult } from "../gcloud.js";
import type {
	SetupState,
	SetupStep,
	StepAlternative,
	StepResult,
} from "../types.js";

const CREATE_RETRIES = 3;

const ORG_POLICY_PATTERN =
	/PERMISSION_DENIED|caller does not have permission|violates .*constraint|constraint violation/i;

const orgPolicyAlternatives = (state: SetupState): StepAlternative[] => [
	{
		id: "reuse_existing_project",
		description:
			"Use a Google Cloud project that already exists and the user can " +
			"access — ask them for its project ID.",
		nextCall: {
			step: "project_provisioning",
			inputs: { projectId: "<their-project-id>" },
		},
	},
	{
		id: "personal_provisioning_account",
		description:
			"Sign into gcloud with a personal Google account instead — the " +
			"provisioning identity is independent of the Slides accounts, so " +
			"infrastructure can live on a personal account while work happens " +
			`on ${state.provisioningAccount ?? "the Workspace account"}.`,
		nextCall: { step: "provisioning_signin" },
	},
	{
		id: "internal_user_type",
		description:
			"If staying on Workspace and the admin allows Internal apps: the " +
			"consent screen's Internal user type also removes the " +
			"unverified-app warning entirely.",
	},
	{
		id: "ask_workspace_admin",
		description:
			"Ask a Workspace administrator to lift the project-creation " +
			"restriction or provision the project.",
	},
];

/** Step 3 (PRD §5.1): create or reuse the GCP project and enable the
 * Slides/Drive/Sheets APIs. Free — no billing account required. */
export const projectProvisioning: SetupStep = {
	id: "project_provisioning",
	title: "Create the Google Cloud project and enable APIs",

	// Ground truth here (projects/services state) costs a gcloud round trip
	// per check, so completion relies on the recorded flag; run_diagnostics
	// re-verifies APIs against live endpoints (PRD §5.2).
	async isComplete(_ctx, state) {
		return Boolean(state.steps.project_provisioning && state.projectId);
	},

	pendingInstructions: (state) =>
		"Ask for the user's go-ahead to create a dedicated Google Cloud " +
		`project (free, no billing account) under ${state.provisioningAccount ?? "their provisioning account"} ` +
		"and enable the Slides, Drive, and Sheets APIs on it. If they prefer " +
		"an existing project, pass its ID as projectId.",

	async run(ctx, state, inputs): Promise<StepResult> {
		if (!state.gcloudPath) {
			return {
				step: "project_provisioning",
				status: "failed",
				detail: "gcloud path unknown",
				instructions: "Run the preflight step first.",
			};
		}
		const gcloud = new GcloudCli(ctx.exec, state.gcloudPath);

		let projectId: string;
		let reused: boolean;
		if (inputs.projectId) {
			const describe = await gcloud.describeProject(inputs.projectId);
			if (describe.exitCode !== 0) {
				return {
					step: "project_provisioning",
					status: "failed",
					detail: `project ${inputs.projectId} not accessible`,
					instructions:
						`gcloud cannot see the project "${inputs.projectId}" from ` +
						`${state.provisioningAccount ?? "the current account"}. Ask the ` +
						"user to double-check the project ID, or offer the alternatives.",
					commandsRun: gcloud.commands,
					alternatives: orgPolicyAlternatives(state),
					inputs: { projectId: "an existing project ID to reuse" },
				};
			}
			projectId = inputs.projectId;
			reused = true;
		} else {
			const created = await createWithRetry(gcloud);
			if (!created.ok) {
				const orgPolicy = ORG_POLICY_PATTERN.test(
					created.last.stderr + created.last.stdout,
				);
				return {
					step: "project_provisioning",
					status: "failed",
					detail: orgPolicy
						? "project creation blocked (likely a Workspace org policy)"
						: `project creation failed (exit ${created.last.exitCode})`,
					instructions: orgPolicy
						? "Project creation was denied — on managed Google Workspace " +
							"accounts an org policy often blocks this. Walk the user " +
							"through the alternatives."
						: "Project creation failed. Show the user the command output " +
							"and offer the alternatives.",
					commandsRun: gcloud.commands,
					alternatives: orgPolicyAlternatives(state),
					inputs: { projectId: "an existing project ID to reuse" },
				};
			}
			projectId = created.projectId;
			reused = false;
		}

		const enable = await enableWithRetry(gcloud, projectId);
		if (enable.exitCode !== 0) {
			return {
				step: "project_provisioning",
				status: "failed",
				detail: `enabling APIs failed (exit ${enable.exitCode})`,
				instructions:
					"The project exists but enabling the APIs failed — when the " +
					"project was created moments ago this is usually propagation " +
					"delay. Wait a few seconds and run this step again.",
				commandsRun: gcloud.commands,
			};
		}

		state.projectId = projectId;
		state.projectReused = reused;
		return {
			step: "project_provisioning",
			status: "completed",
			detail: `project ${projectId} ready, APIs enabled`,
			instructions:
				`Tell the user the project ${projectId} is ready with the Slides, ` +
				"Drive, and Sheets APIs enabled — show them the commands that ran. " +
				"The next step is the only manual part: two short visits to the " +
				"Google console to configure the consent screen and create the " +
				"OAuth client.",
			commandsRun: gcloud.commands,
		};
	},
};

async function createWithRetry(
	gcloud: GcloudCli,
): Promise<
	{ ok: true; projectId: string } | { ok: false; last: GcloudResult }
> {
	let last: GcloudResult | undefined;
	for (let attempt = 0; attempt < CREATE_RETRIES; attempt++) {
		const projectId = `${PROJECT_ID_PREFIX}${randomBytes(3).toString("hex")}`;
		last = await gcloud.createProject(projectId);
		if (last.exitCode === 0) return { ok: true, projectId };
		if (!/ALREADY_EXISTS|already in use/i.test(last.stderr + last.stdout)) {
			break;
		}
	}
	return { ok: false, last: last as GcloudResult };
}

/** Retries once immediately: services.enable straight after project
 * creation can race propagation. The step stays re-runnable for the
 * stubborn case (the instructions say so). */
async function enableWithRetry(
	gcloud: GcloudCli,
	projectId: string,
): Promise<GcloudResult> {
	const first = await gcloud.enableServices(projectId);
	if (first.exitCode === 0) return first;
	if (/FAILED_PRECONDITION|NOT_FOUND|does not exist/i.test(first.stderr)) {
		return gcloud.enableServices(projectId);
	}
	return first;
}
