import {
	AUTH_TIMEOUT_MS,
	PROJECT_DISPLAY_NAME,
	REQUIRED_SERVICES,
} from "../constants.js";
import type { CommandRun, ExecRunner } from "./types.js";

const TRUNCATE_AT = 4096;
const truncate = (text: string): string =>
	text.length > TRUNCATE_AT ? `${text.slice(0, TRUNCATE_AT)}…[truncated]` : text;

export interface GcloudResult extends CommandRun {
	timedOut?: boolean;
}

/**
 * Thin gcloud wrapper. Every invocation is recorded verbatim in `commands`
 * so steps can surface exactly what ran against the user's account
 * (PRD §5.1/§5.3).
 */
export class GcloudCli {
	readonly commands: CommandRun[] = [];

	constructor(
		private readonly exec: ExecRunner,
		readonly path: string,
	) {}

	private async run(
		args: string[],
		timeoutMs?: number,
	): Promise<GcloudResult> {
		const result = await this.exec(this.path, args, { timeoutMs });
		const record: GcloudResult = {
			command: [this.path, ...args].join(" "),
			exitCode: result.code,
			stdout: truncate(result.stdout),
			stderr: truncate(result.stderr),
			timedOut: result.timedOut,
		};
		this.commands.push(record);
		return record;
	}

	/** Email of the active gcloud identity, or undefined. */
	async activeAccount(): Promise<string | undefined> {
		const result = await this.run([
			"auth",
			"list",
			"--filter=status:ACTIVE",
			"--format=value(account)",
		]);
		const email = result.stdout.trim().split("\n")[0];
		return result.exitCode === 0 && email ? email : undefined;
	}

	/** Opens the browser itself; blocks until callback or timeout. */
	async login(): Promise<GcloudResult> {
		return this.run(["auth", "login", "--brief"], AUTH_TIMEOUT_MS);
	}

	async createProject(projectId: string): Promise<GcloudResult> {
		return this.run([
			"projects",
			"create",
			projectId,
			`--name=${PROJECT_DISPLAY_NAME}`,
		]);
	}

	async describeProject(projectId: string): Promise<GcloudResult> {
		return this.run(["projects", "describe", projectId, "--format=json"]);
	}

	async enableServices(projectId: string): Promise<GcloudResult> {
		return this.run([
			"services",
			"enable",
			...REQUIRED_SERVICES,
			`--project=${projectId}`,
		]);
	}
}
