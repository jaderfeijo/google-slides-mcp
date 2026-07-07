import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SetupEngine } from "../../src/setup/engine.js";
import {
	FileStateStore,
	MemoryStateStore,
} from "../../src/setup/state-store.js";
import {
	emptyState,
	type SetupState,
	type SetupStep,
	type StepContext,
	type StepId,
	type StepResult,
} from "../../src/setup/types.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";

const ctxWith = (store: MemoryStateStore | FileStateStore): StepContext => ({
	keychain: new MemoryKeychain(),
	state: store,
	exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	fs: {
		exists: async () => false,
		readFile: async () => "",
		unlink: async () => {},
	},
	runAuthFlow: (async () => {
		throw new Error("unused");
	}) as never,
	fetch: (async () => new Response()) as typeof fetch,
	slides: () => {
		throw new Error("unused");
	},
	platform: "darwin",
	homeDir: "/tmp/home",
	log: () => {},
});

/** Fake step whose completion derives from a marker in state (like real
 * steps derive from the Keychain/gcloud). */
const fakeStep = (
	id: StepId,
	outcome: StepResult["status"] = "completed",
): SetupStep & { runs: number } => {
	const step = {
		id,
		title: `fake ${id}`,
		runs: 0,
		async isComplete(_ctx: StepContext, state: SetupState) {
			return Boolean(state.steps[id]);
		},
		pendingInstructions: () => `do ${id}`,
		async run(): Promise<StepResult> {
			step.runs += 1;
			return {
				step: id,
				status: outcome,
				detail: `${id} ran`,
				instructions: "next",
			};
		},
	};
	return step;
};

describe("FileStateStore", () => {
	it("returns empty state for a missing file and round-trips writes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "slides-mcp-state-"));
		const store = new FileStateStore(join(dir, "nested", "state.json"));

		expect(await store.read()).toEqual(emptyState());

		const state = emptyState();
		state.projectId = "slides-mcp-abc123";
		state.steps.preflight = { completedAt: "2026-07-07T00:00:00Z" };
		await store.write(state);

		expect(await store.read()).toEqual(state);
		// Human-inspectable JSON on disk (PRD §6).
		const raw = await readFile(join(dir, "nested", "state.json"), "utf8");
		expect(JSON.parse(raw).projectId).toBe("slides-mcp-abc123");
	});

	it("treats a corrupt file as empty state", async () => {
		const dir = await mkdtemp(join(tmpdir(), "slides-mcp-state-"));
		const path = join(dir, "state.json");
		await writeFile(path, "{not json", "utf8");
		expect(await new FileStateStore(path).read()).toEqual(emptyState());
	});
});

describe("SetupEngine", () => {
	it("runs the first incomplete step and persists completion", async () => {
		const store = new MemoryStateStore();
		const s1 = fakeStep("preflight");
		const s2 = fakeStep("provisioning_signin");
		const engine = new SetupEngine(ctxWith(store), [s1, s2]);

		const r1 = await engine.run();
		expect(r1.step).toBe("preflight");
		expect(s1.runs).toBe(1);

		const r2 = await engine.run();
		expect(r2.step).toBe("provisioning_signin");
		expect(s1.runs).toBe(1);
		expect(s2.runs).toBe(1);
	});

	it("does not mark action_required steps complete", async () => {
		const store = new MemoryStateStore();
		const s1 = fakeStep("preflight", "action_required");
		const engine = new SetupEngine(ctxWith(store), [s1]);

		await engine.run();
		await engine.run();
		expect(s1.runs).toBe(2);
		expect((await store.read()).steps.preflight).toBeUndefined();
	});

	it("resumes across engine instances (simulated process kill)", async () => {
		const store = new MemoryStateStore();
		const steps = () => [fakeStep("preflight"), fakeStep("console_client")];

		const first = steps();
		await new SetupEngine(ctxWith(store), first).run();

		const second = steps();
		const result = await new SetupEngine(ctxWith(store), second).run();
		expect(result.step).toBe("console_client");
		expect(second[0].runs).toBe(0);
	});

	it("re-runs a named step even when already complete (recovery)", async () => {
		const store = new MemoryStateStore();
		const s1 = fakeStep("console_client");
		const engine = new SetupEngine(ctxWith(store), [s1]);

		await engine.run();
		const rerun = await engine.run({ step: "console_client" });
		expect(rerun.step).toBe("console_client");
		expect(s1.runs).toBe(2);
	});

	it("rejects unknown named steps", async () => {
		const engine = new SetupEngine(ctxWith(new MemoryStateStore()), []);
		await expect(engine.run({ step: "explode" as never })).rejects.toThrow(
			/unknown setup step/i,
		);
	});

	it("reports already-complete setup", async () => {
		const store = new MemoryStateStore();
		const s1 = fakeStep("first_account_auth");
		const engine = new SetupEngine(ctxWith(store), [s1]);
		await engine.run();

		const result = await engine.run();
		expect(result.status).toBe("completed");
		expect(result.detail).toContain("already complete");
		expect(s1.runs).toBe(1);
	});

	it("status() marks completed/current/pending and carries instructions", async () => {
		const store = new MemoryStateStore();
		const s1 = fakeStep("preflight");
		const s2 = fakeStep("console_client");
		const s3 = fakeStep("first_account_auth");
		const engine = new SetupEngine(ctxWith(store), [s1, s2, s3]);
		await engine.run();

		const status = await engine.status();
		expect(status.configured).toBe(false);
		expect(status.currentStep).toBe("console_client");
		expect(status.steps.map((s) => s.status)).toEqual([
			"completed",
			"current",
			"pending",
		]);
		expect(status.steps[1].instructions).toBe("do console_client");
		expect(status.steps[0].instructions).toBeUndefined();
	});

	it("status() reports configured when every step is complete", async () => {
		const store = new MemoryStateStore();
		const s1 = fakeStep("preflight");
		const engine = new SetupEngine(ctxWith(store), [s1]);
		await engine.run();

		const status = await engine.status();
		expect(status.configured).toBe(true);
		expect(status.currentStep).toBeUndefined();
	});
});
