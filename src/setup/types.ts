import type { ScopeTier } from "../constants.js";
import type { KeychainStore } from "../keychain/store.js";
import type { SlidesClientFactory } from "../google/slides-client.js";
import type { runPkceFlow } from "../auth/pkce.js";
import type { SetupStateStore } from "./state-store.js";

/** The five setup steps, in order (PRD §5.1). */
export const STEP_IDS = [
	"preflight",
	"provisioning_signin",
	"project_provisioning",
	"console_client",
	"first_account_auth",
] as const;
export type StepId = (typeof STEP_IDS)[number];

/** One external command, surfaced verbatim to the user (PRD §5.1/§5.3). */
export interface CommandRun {
	command: string;
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** An alternative path offered on a branch (e.g. Workspace org policy). */
export interface StepAlternative {
	id: string;
	/** What Claude explains to the user. */
	description: string;
	/** How to take this path, machine-readable. */
	nextCall?: { step: StepId; inputs?: Record<string, unknown> };
}

/** The shape every step returns — the API Claude consumes conversationally. */
export interface StepResult {
	step: StepId;
	status: "completed" | "action_required" | "failed";
	/** One-line summary ("gcloud found at /opt/homebrew/bin/gcloud"). */
	detail: string;
	/** Exactly what Claude should tell or ask the user next. Always present. */
	instructions: string;
	/** Every external command executed, verbatim, in order. */
	commandsRun?: CommandRun[];
	/** Console deep links for guided-manual steps. */
	links?: Array<{ label: string; url: string }>;
	/** Ordered checklist items Claude relays, one at a time if the user wants. */
	checklist?: string[];
	/** Inputs run_setup_step accepts on the next call for this step
	 * (name → human description). Present iff status !== completed. */
	inputs?: Record<string, string>;
	/** Branch options (org-policy denial, gcloud missing, ...). */
	alternatives?: StepAlternative[];
	/** Only on the final step's completion: the summary Claude relays. */
	setupComplete?: { account: string; tier: ScopeTier; projectId?: string };
}

/** Optional inputs to run_setup_step, routed to the step that runs. */
export interface RunStepInputs {
	step?: StepId;
	projectId?: string;
	installGcloud?: boolean;
	clientJsonPath?: string;
	clientJsonContents?: string;
	confirmDeleteFile?: boolean;
	tier?: ScopeTier;
}

/** Persisted at ~/.config/slides-mcp/state.json. Non-secret, disposable —
 * steps re-derive completion from ground truth (Keychain, gcloud). */
export interface SetupState {
	schemaVersion: number;
	steps: Partial<Record<StepId, { completedAt: string; account?: string }>>;
	gcloudPath?: string;
	projectId?: string;
	projectReused?: boolean;
	provisioningAccount?: string;
	pendingClientFileDelete?: string;
}

export const emptyState = (): SetupState => ({ schemaVersion: 1, steps: {} });

/** Injectable process runner (absolute paths only — GUI children have a
 * minimal PATH, PRD §9). */
export type ExecRunner = (
	command: string,
	args: string[],
	options?: { timeoutMs?: number },
) => Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>;

/** Injectable filesystem seam for the client-JSON import. */
export interface SetupFs {
	exists(path: string): Promise<boolean>;
	readFile(path: string): Promise<string>;
	unlink(path: string): Promise<void>;
}

/** Everything a step may touch — all injectable for tests. */
export interface StepContext {
	keychain: KeychainStore;
	state: SetupStateStore;
	exec: ExecRunner;
	fs: SetupFs;
	runAuthFlow: typeof runPkceFlow;
	fetch: typeof globalThis.fetch;
	slides: SlidesClientFactory;
	platform: NodeJS.Platform;
	homeDir: string;
	log: (line: string) => void;
}

export interface SetupStep {
	id: StepId;
	title: string;
	/** Re-derived truth, not just flags (e.g. console_client is complete iff
	 * the client entry exists in the Keychain). Makes state.json disposable. */
	isComplete(ctx: StepContext, state: SetupState): Promise<boolean>;
	/** Instructions shown by get_setup_status before the step runs. */
	pendingInstructions(state: SetupState): string;
	run(
		ctx: StepContext,
		state: SetupState,
		inputs: RunStepInputs,
	): Promise<StepResult>;
}
