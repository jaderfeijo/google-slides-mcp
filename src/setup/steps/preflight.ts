import {
	BREW_PROBE_PATHS,
	GCLOUD_INSTALL_TIMEOUT_MS,
	GCLOUD_PROBE_PATHS,
	GCLOUD_SDK_INSTALL_URL,
	SW_VERS_PATH,
} from "../../constants.js";
import { probeBinary } from "../probe.js";
import type { CommandRun, SetupStep, StepResult } from "../types.js";

/** Step 1 (PRD §5.1): macOS check + gcloud detection, with a consented
 * Homebrew install path when gcloud is missing. */
export const preflight: SetupStep = {
	id: "preflight",
	title: "Check macOS and find the Google Cloud CLI",

	async isComplete(ctx, state) {
		if (ctx.platform !== "darwin") return false;
		if (state.gcloudPath && (await ctx.fs.exists(state.gcloudPath))) {
			return true;
		}
		return Boolean(
			await probeBinary(ctx.fs, GCLOUD_PROBE_PATHS(ctx.homeDir)),
		);
	},

	pendingInstructions: () =>
		"Tell the user setup starts by checking this Mac for the Google Cloud " +
		"CLI (gcloud), which automates the Google-side provisioning. Nothing " +
		"is installed or changed without their explicit go-ahead.",

	async run(ctx, state, inputs): Promise<StepResult> {
		if (ctx.platform !== "darwin") {
			return {
				step: "preflight",
				status: "failed",
				detail: `unsupported platform ${ctx.platform}`,
				instructions:
					"Tell the user slides-mcp v1 supports macOS only (the Keychain " +
					"dependency is deliberate).",
			};
		}

		const commandsRun: CommandRun[] = [];
		const version = await ctx.exec(SW_VERS_PATH, ["-productVersion"]);
		commandsRun.push({
			command: `${SW_VERS_PATH} -productVersion`,
			exitCode: version.code,
			stdout: version.stdout,
			stderr: version.stderr,
		});

		if (inputs.installGcloud) {
			const brew = await probeBinary(ctx.fs, BREW_PROBE_PATHS);
			if (!brew) {
				return {
					step: "preflight",
					status: "failed",
					detail: "Homebrew not found",
					instructions:
						"Homebrew is not installed, so the automatic install is not " +
						`available. Ask the user to install the SDK manually from ${GCLOUD_SDK_INSTALL_URL}, then run this step again.`,
					commandsRun,
					links: [{ label: "Install the Google Cloud SDK", url: GCLOUD_SDK_INSTALL_URL }],
				};
			}
			const install = await ctx.exec(
				brew,
				["install", "--cask", "google-cloud-sdk"],
				{ timeoutMs: GCLOUD_INSTALL_TIMEOUT_MS },
			);
			commandsRun.push({
				command: `${brew} install --cask google-cloud-sdk`,
				exitCode: install.code,
				stdout: install.stdout.slice(-2048),
				stderr: install.stderr.slice(-2048),
			});
			if (install.code !== 0) {
				return {
					step: "preflight",
					status: "failed",
					detail: install.timedOut
						? "Homebrew install timed out"
						: `Homebrew install exited ${install.code}`,
					instructions:
						"The install did not finish. Show the user the command output " +
						"and suggest running it in a terminal, then run this step again.",
					commandsRun,
				};
			}
		}

		const gcloud = await probeBinary(ctx.fs, GCLOUD_PROBE_PATHS(ctx.homeDir));
		if (!gcloud) {
			const brew = await probeBinary(ctx.fs, BREW_PROBE_PATHS);
			return {
				step: "preflight",
				status: brew ? "action_required" : "failed",
				detail: "gcloud not found",
				instructions: brew
					? "gcloud is not installed. Ask the user for permission to run " +
						`\`${brew} install --cask google-cloud-sdk\` (a few minutes); ` +
						"on yes, call this step again with installGcloud: true."
					: "gcloud is not installed and Homebrew is missing. Ask the user " +
						`to install the SDK from ${GCLOUD_SDK_INSTALL_URL}, then run this step again.`,
				commandsRun,
				...(brew
					? {
							inputs: {
								installGcloud:
									"set true after the user consents to the Homebrew install",
							},
						}
					: {
							links: [
								{
									label: "Install the Google Cloud SDK",
									url: GCLOUD_SDK_INSTALL_URL,
								},
							],
						}),
			};
		}

		const gcloudVersion = await ctx.exec(gcloud, ["--version"]);
		commandsRun.push({
			command: `${gcloud} --version`,
			exitCode: gcloudVersion.code,
			stdout: gcloudVersion.stdout.split("\n")[0] ?? "",
			stderr: gcloudVersion.stderr,
		});

		state.gcloudPath = gcloud;
		return {
			step: "preflight",
			status: "completed",
			detail: `gcloud found at ${gcloud} (macOS ${version.stdout.trim()})`,
			instructions:
				"Tell the user gcloud is ready. The next step signs into Google " +
				"Cloud to provision infrastructure — this identity can be any " +
				"Google account and is separate from the account whose Slides " +
				"they'll edit.",
			commandsRun,
		};
	},
};
