import { describe, expect, it, vi } from "vitest";

import { AuthManager } from "../../src/auth/manager.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import { SetupEngine } from "../../src/setup/engine.js";
import { MemoryStateStore } from "../../src/setup/state-store.js";
import type {
	SetupStep,
	StepContext,
	StepResult,
} from "../../src/setup/types.js";
import {
	registerTools,
	type AnyToolDefinition,
	type ToolDeps,
} from "../../src/tools/register.js";
import { getSetupStatus } from "../../src/tools/get-setup-status.js";
import { runSetupStep } from "../../src/tools/run-setup-step.js";

type Handler = (args: Record<string, unknown>) => Promise<{
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}>;

const fakeStep: SetupStep = {
	id: "preflight",
	title: "fake preflight",
	isComplete: async () => false,
	pendingInstructions: () => "run preflight",
	async run(_ctx, _state, inputs): Promise<StepResult> {
		return {
			step: "preflight",
			status: inputs.installGcloud ? "completed" : "failed",
			detail: "fake ran",
			instructions: "relay this",
		};
	},
};

const engineWith = (steps: SetupStep[]): SetupEngine =>
	new SetupEngine(
		{
			keychain: new MemoryKeychain(),
			state: new MemoryStateStore(),
			exec: async () => ({ code: 0, stdout: "", stderr: "" }),
			fs: {
				exists: async () => false,
				readFile: async () => "",
				unlink: async () => {},
			},
			runAuthFlow: (async () => {
				throw new Error("unused");
			}) as never,
	getAccessToken: async () => "at-test",
			fetch: (async () => new Response()) as typeof fetch,
			slides: () => {
				throw new Error("unused");
			},
			platform: "darwin",
			homeDir: "/tmp/home",
			log: () => {},
		} satisfies StepContext,
		steps,
	);

/** Deps with a completely EMPTY keychain — proving the setup tools work in
 * unconfigured mode through the standard wrapper (the register.ts invariant). */
const unconfiguredDeps = (engine: SetupEngine): ToolDeps => ({
	keychain: new MemoryKeychain(),
	auth: new AuthManager(new MemoryKeychain(), async () => {
		throw new Error("unreachable");
	}),
	slides: () => {
		throw new Error("unreachable");
	},
	setup: engine,
});

const capture = (tools: AnyToolDefinition[], deps: ToolDeps) => {
	const handlers = new Map<string, Handler>();
	const server = {
		registerTool: (name: string, _config: unknown, handler: Handler) => {
			handlers.set(name, handler);
		},
	};
	registerTools(server as never, deps, tools);
	return handlers;
};

describe("get_setup_status tool", () => {
	it("works with an empty keychain and reports the current step", async () => {
		const handlers = capture(
			[getSetupStatus],
			unconfiguredDeps(engineWith([fakeStep])),
		);

		const result = await handlers.get("get_setup_status")!({});
		expect(result.isError).toBeUndefined();
		const payload = JSON.parse(result.content[0].text);
		expect(payload.configured).toBe(false);
		expect(payload.currentStep).toBe("preflight");
		expect(payload.steps[0].instructions).toBe("run preflight");
		expect(payload.resumeHint).toContain("resumable");
	});
});

describe("run_setup_step tool", () => {
	it("routes inputs to the step and returns the StepResult verbatim", async () => {
		const handlers = capture(
			[runSetupStep],
			unconfiguredDeps(engineWith([fakeStep])),
		);

		const result = await handlers.get("run_setup_step")!({
			step: "preflight",
			installGcloud: true,
		});
		const payload = JSON.parse(result.content[0].text);
		expect(payload.status).toBe("completed");
		expect(payload.instructions).toBe("relay this");
	});

	it("returns failed results as conversational payloads, not isError", async () => {
		const handlers = capture(
			[runSetupStep],
			unconfiguredDeps(engineWith([fakeStep])),
		);

		const result = await handlers.get("run_setup_step")!({});
		expect(result.isError).toBeUndefined();
		expect(JSON.parse(result.content[0].text).status).toBe("failed");
	});

	it("exposes a schema that rejects unknown steps", () => {
		const schema = runSetupStep.inputSchema.step;
		expect(schema.safeParse("preflight").success).toBe(true);
		expect(schema.safeParse("explode").success).toBe(false);
	});
});

describe("cli setup commands", () => {
	it("dispatches setup status and step through an injected engine", async () => {
		const { main } = await import("../../src/cli.js");
		const engine = engineWith([fakeStep]);
		const statusSpy = vi.spyOn(engine, "status");
		const runSpy = vi.spyOn(engine, "run");

		expect(
			await main(["setup", "status"], new MemoryKeychain(), engine),
		).toBe(0);
		expect(statusSpy).toHaveBeenCalledOnce();

		expect(
			await main(
				["setup", "step", "preflight", "--install-gcloud"],
				new MemoryKeychain(),
				engine,
			),
		).toBe(0);
		expect(runSpy).toHaveBeenCalledWith(
			expect.objectContaining({ step: "preflight", installGcloud: true }),
		);
	});

	it("exits non-zero when a step fails", async () => {
		const { main } = await import("../../src/cli.js");
		expect(
			await main(
				["setup", "step"],
				new MemoryKeychain(),
				engineWith([fakeStep]),
			),
		).toBe(1);
	});

	it("rejects unknown step names", async () => {
		const { main } = await import("../../src/cli.js");
		expect(
			await main(
				["setup", "step", "bogus"],
				new MemoryKeychain(),
				engineWith([fakeStep]),
			),
		).toBe(1);
	});
});
