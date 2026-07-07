import {
	STEP_IDS,
	type RunStepInputs,
	type SetupState,
	type SetupStep,
	type StepContext,
	type StepId,
	type StepResult,
} from "./types.js";

/** get_setup_status payload (PRD §5.1). */
export interface SetupStatus {
	configured: boolean;
	currentStep?: StepId;
	steps: Array<{
		id: StepId;
		title: string;
		status: "completed" | "current" | "pending";
		instructions?: string;
	}>;
	resumeHint: string;
}

const RESUME_HINT =
	"Call run_setup_step to run the current step. Setup is resumable; " +
	"nothing is lost if the conversation or app is closed mid-way.";

/**
 * The setup state machine (PRD §5.1). Stateless per call: every run() and
 * status() re-reads state.json and re-derives step completion from ground
 * truth, so killing the process or deleting the state file loses nothing.
 */
export class SetupEngine {
	constructor(
		private readonly ctx: StepContext,
		private readonly steps: ReadonlyArray<SetupStep>,
	) {}

	async status(): Promise<SetupStatus> {
		const state = await this.ctx.state.read();
		const completion = await this.completion(state);
		const firstIncomplete = this.steps.find((s) => !completion.get(s.id));

		return {
			configured: !firstIncomplete,
			...(firstIncomplete ? { currentStep: firstIncomplete.id } : {}),
			steps: this.steps.map((step) => ({
				id: step.id,
				title: step.title,
				status: completion.get(step.id)
					? "completed"
					: step === firstIncomplete
						? "current"
						: "pending",
				...(step === firstIncomplete
					? { instructions: step.pendingInstructions(state) }
					: {}),
			})),
			resumeHint: RESUME_HINT,
		};
	}

	async run(inputs: RunStepInputs = {}): Promise<StepResult> {
		const state = await this.ctx.state.read();

		let step: SetupStep | undefined;
		if (inputs.step) {
			// Named steps may be re-run even when complete (recovery paths,
			// e.g. recreating an OAuth client Google auto-deleted, PRD §9).
			step = this.steps.find((s) => s.id === inputs.step);
			if (!step) {
				throw new Error(
					`Unknown setup step "${inputs.step}" (valid: ${STEP_IDS.join(", ")})`,
				);
			}
		} else {
			const completion = await this.completion(state);
			step = this.steps.find((s) => !completion.get(s.id));
			if (!step) {
				return {
					step: this.steps[this.steps.length - 1].id,
					status: "completed",
					detail: "setup is already complete",
					instructions:
						"Setup is complete — no steps remain. The user can just ask " +
						"for slides; run_diagnostics checks health if something misbehaves.",
				};
			}
		}

		const result = await step.run(this.ctx, state, inputs);
		if (result.status === "completed" && !state.steps[step.id]) {
			state.steps[step.id] = { completedAt: new Date().toISOString() };
		}
		await this.ctx.state.write(state);
		return result;
	}

	private async completion(
		state: SetupState,
	): Promise<Map<StepId, boolean>> {
		const map = new Map<StepId, boolean>();
		for (const step of this.steps) {
			map.set(step.id, await step.isComplete(this.ctx, state));
		}
		return map;
	}
}
