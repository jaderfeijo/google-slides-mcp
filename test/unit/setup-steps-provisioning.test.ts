import { describe, expect, it } from "vitest";

import { preflight } from "../../src/setup/steps/preflight.js";
import { provisioningSignin } from "../../src/setup/steps/provisioning-signin.js";
import { projectProvisioning } from "../../src/setup/steps/project-provisioning.js";
import { MemoryStateStore } from "../../src/setup/state-store.js";
import {
	emptyState,
	type ExecRunner,
	type SetupState,
	type StepContext,
} from "../../src/setup/types.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";

interface ExecCall {
	command: string;
	args: string[];
	timeoutMs?: number;
}

/** Routes exec calls by matching a substring of `command args...`. */
const routedExec = (
	routes: Array<{
		match: RegExp;
		code?: number;
		stdout?: string;
		stderr?: string;
		timedOut?: boolean;
	}>,
	calls: ExecCall[] = [],
): ExecRunner =>
	async (command, args, options) => {
		calls.push({ command, args, timeoutMs: options?.timeoutMs });
		const line = [command, ...args].join(" ");
		const route = routes.find((r) => r.match.test(line));
		if (!route) return { code: 0, stdout: "", stderr: "" };
		return {
			code: route.code ?? 0,
			stdout: route.stdout ?? "",
			stderr: route.stderr ?? "",
			timedOut: route.timedOut,
		};
	};

const ctxWith = (
	overrides: Partial<StepContext>,
): StepContext => ({
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
	homeDir: "/Users/tester",
	log: () => {},
	...overrides,
});

const existingPaths = (paths: string[]) => ({
	exists: async (p: string) => paths.includes(p),
	readFile: async () => "",
	unlink: async () => {},
});

describe("preflight step", () => {
	it("fails on non-macOS", async () => {
		const result = await preflight.run(
			ctxWith({ platform: "linux" }),
			emptyState(),
			{},
		);
		expect(result.status).toBe("failed");
		expect(result.instructions).toContain("macOS only");
	});

	it("completes when gcloud exists, persisting the path", async () => {
		const state = emptyState();
		const result = await preflight.run(
			ctxWith({
				fs: existingPaths(["/opt/homebrew/bin/gcloud"]),
				exec: routedExec([
					{ match: /sw_vers/, stdout: "15.5\n" },
					{ match: /--version/, stdout: "Google Cloud SDK 530.0.0\n" },
				]),
			}),
			state,
			{},
		);
		expect(result.status).toBe("completed");
		expect(state.gcloudPath).toBe("/opt/homebrew/bin/gcloud");
		expect(result.commandsRun?.map((c) => c.command)).toContain(
			"/usr/bin/sw_vers -productVersion",
		);
	});

	it("asks consent to install via brew when gcloud is missing", async () => {
		const result = await preflight.run(
			ctxWith({ fs: existingPaths(["/opt/homebrew/bin/brew"]) }),
			emptyState(),
			{},
		);
		expect(result.status).toBe("action_required");
		expect(result.inputs).toHaveProperty("installGcloud");
		expect(result.instructions).toContain(
			"/opt/homebrew/bin/brew install --cask google-cloud-sdk",
		);
	});

	it("fails with the manual link when brew is missing too", async () => {
		const result = await preflight.run(ctxWith({}), emptyState(), {});
		expect(result.status).toBe("failed");
		expect(result.links?.[0].url).toContain("cloud.google.com/sdk");
	});

	it("runs the consented install and re-probes", async () => {
		const found: string[] = ["/opt/homebrew/bin/brew"];
		const result = await preflight.run(
			ctxWith({
				fs: {
					exists: async (p) => found.includes(p),
					readFile: async () => "",
					unlink: async () => {},
				},
				exec: routedExec([
					{
						match: /brew install/,
						code: 0,
					},
					{ match: /sw_vers/, stdout: "15.5\n" },
				]),
			}),
			emptyState(),
			{ installGcloud: true },
		);
		// install "succeeded" but probe still finds nothing → not completed
		expect(result.status).not.toBe("completed");

		found.push("/opt/homebrew/bin/gcloud");
		const state = emptyState();
		const retry = await preflight.run(
			ctxWith({
				fs: {
					exists: async (p) => found.includes(p),
					readFile: async () => "",
					unlink: async () => {},
				},
				exec: routedExec([{ match: /./, code: 0, stdout: "" }]),
			}),
			state,
			{ installGcloud: true },
		);
		expect(retry.status).toBe("completed");
	});
});

describe("provisioning_signin step", () => {
	const state = (): SetupState => ({
		...emptyState(),
		gcloudPath: "/opt/homebrew/bin/gcloud",
	});

	it("skips the browser when already signed in", async () => {
		const calls: ExecCall[] = [];
		const result = await provisioningSignin.run(
			ctxWith({
				exec: routedExec(
					[{ match: /auth list/, stdout: "boss@corp.com\n" }],
					calls,
				),
			}),
			state(),
			{},
		);
		expect(result.status).toBe("completed");
		expect(result.detail).toContain("boss@corp.com");
		expect(calls.some((c) => c.args.includes("login"))).toBe(false);
	});

	it("logs in when no active account and records the account", async () => {
		let signedIn = false;
		const exec: ExecRunner = async (command, args, options) => {
			const line = args.join(" ");
			if (line.includes("auth list")) {
				return {
					code: 0,
					stdout: signedIn ? "personal@gmail.com\n" : "",
					stderr: "",
				};
			}
			if (line.includes("auth login")) {
				expect(options?.timeoutMs).toBe(5 * 60 * 1000);
				signedIn = true;
				return { code: 0, stdout: "", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		};
		const s = state();
		const result = await provisioningSignin.run(ctxWith({ exec }), s, {});
		expect(result.status).toBe("completed");
		expect(s.provisioningAccount).toBe("personal@gmail.com");
	});

	it("fails cleanly on login timeout", async () => {
		const result = await provisioningSignin.run(
			ctxWith({
				exec: routedExec([
					{ match: /auth list/, stdout: "" },
					{ match: /auth login/, code: 1, timedOut: true },
				]),
			}),
			state(),
			{},
		);
		expect(result.status).toBe("failed");
		expect(result.detail).toContain("timed out");
	});

	it("fails when gcloud path is unknown (preflight not run)", async () => {
		const result = await provisioningSignin.run(ctxWith({}), emptyState(), {});
		expect(result.status).toBe("failed");
		expect(result.instructions).toContain("preflight");
	});
});

describe("project_provisioning step", () => {
	const state = (): SetupState => ({
		...emptyState(),
		gcloudPath: "/opt/homebrew/bin/gcloud",
		provisioningAccount: "boss@corp.com",
	});

	it("creates a project and enables the APIs", async () => {
		const calls: ExecCall[] = [];
		const s = state();
		const result = await projectProvisioning.run(
			ctxWith({ exec: routedExec([{ match: /./, code: 0 }], calls) }),
			s,
			{},
		);
		expect(result.status).toBe("completed");
		expect(s.projectId).toMatch(/^slides-mcp-[0-9a-f]{6}$/);
		expect(s.projectReused).toBe(false);
		const enable = calls.find((c) => c.args[0] === "services");
		expect(enable?.args).toContain("slides.googleapis.com");
	});

	it("reuses an accessible existing project", async () => {
		const s = state();
		const result = await projectProvisioning.run(
			ctxWith({
				exec: routedExec([
					{ match: /projects describe/, stdout: "{}" },
					{ match: /services enable/, code: 0 },
				]),
			}),
			s,
			{ projectId: "my-existing-project" },
		);
		expect(result.status).toBe("completed");
		expect(s.projectId).toBe("my-existing-project");
		expect(s.projectReused).toBe(true);
	});

	it("retries with a fresh suffix on ALREADY_EXISTS", async () => {
		let creates = 0;
		const exec: ExecRunner = async (_c, args) => {
			if (args[0] === "projects" && args[1] === "create") {
				creates += 1;
				return creates < 3
					? { code: 1, stdout: "", stderr: "ALREADY_EXISTS" }
					: { code: 0, stdout: "", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		};
		const result = await projectProvisioning.run(ctxWith({ exec }), state(), {});
		expect(result.status).toBe("completed");
		expect(creates).toBe(3);
	});

	it("returns the Workspace alternatives on an org-policy denial", async () => {
		const result = await projectProvisioning.run(
			ctxWith({
				exec: routedExec([
					{
						match: /projects create/,
						code: 1,
						stderr:
							"ERROR: (gcloud.projects.create) PERMISSION_DENIED: caller does not have permission",
					},
				]),
			}),
			state(),
			{},
		);
		expect(result.status).toBe("failed");
		expect(result.detail).toContain("org policy");
		expect(result.alternatives?.map((a) => a.id)).toEqual([
			"reuse_existing_project",
			"personal_provisioning_account",
			"internal_user_type",
			"ask_workspace_admin",
		]);
		expect(result.alternatives?.[0].nextCall?.step).toBe(
			"project_provisioning",
		);
	});

	it("retries services enable once on propagation races", async () => {
		let enables = 0;
		const exec: ExecRunner = async (_c, args) => {
			if (args[0] === "services") {
				enables += 1;
				return enables === 1
					? { code: 1, stdout: "", stderr: "FAILED_PRECONDITION" }
					: { code: 0, stdout: "", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		};
		const result = await projectProvisioning.run(ctxWith({ exec }), state(), {});
		expect(result.status).toBe("completed");
		expect(enables).toBe(2);
	});

	it("surfaces every command verbatim", async () => {
		const result = await projectProvisioning.run(
			ctxWith({ exec: routedExec([{ match: /./, code: 0 }]) }),
			state(),
			{},
		);
		expect(result.commandsRun?.length).toBeGreaterThanOrEqual(2);
		expect(result.commandsRun?.[0].command).toMatch(
			/^\/opt\/homebrew\/bin\/gcloud projects create slides-mcp-[0-9a-f]{6}/,
		);
	});
});
