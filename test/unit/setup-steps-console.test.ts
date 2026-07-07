import { describe, expect, it, vi } from "vitest";

import { consoleClient } from "../../src/setup/steps/console-client.js";
import { MemoryStateStore } from "../../src/setup/state-store.js";
import { emptyState, type StepContext } from "../../src/setup/types.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import { SERVICE_CLIENT } from "../../src/constants.js";

const VALID_JSON = JSON.stringify({
	installed: {
		client_id: "abc.apps.googleusercontent.com",
		client_secret: "s3cret",
		project_id: "slides-mcp-abc123",
	},
});

const ctxWith = (overrides: Partial<StepContext> = {}): StepContext => ({
	keychain: new MemoryKeychain(),
	state: new MemoryStateStore(),
	exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	fs: {
		exists: async () => false,
		readFile: async () => VALID_JSON,
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
	homeDir: "/Users/tester",
	log: () => {},
	...overrides,
});

describe("console_client phase A (guidance)", () => {
	it("returns project-scoped deep links and the full checklist", async () => {
		const state = { ...emptyState(), projectId: "slides-mcp-abc123" };
		const result = await consoleClient.run(ctxWith(), state, {});

		expect(result.status).toBe("action_required");
		for (const link of result.links ?? []) {
			expect(link.url).toContain("project=slides-mcp-abc123");
			expect(link.url).toContain("console.cloud.google.com/auth/");
		}
		const checklist = result.checklist?.join("\n") ?? "";
		expect(checklist).toContain("In production");
		expect(checklist).toContain("Desktop app");
		expect(checklist).toContain("https://www.googleapis.com/auth/presentations");
		expect(checklist).toContain("https://www.googleapis.com/auth/drive.file");
		expect(checklist).toContain("https://www.googleapis.com/auth/drive");
		expect(checklist).toContain(
			"https://www.googleapis.com/auth/spreadsheets.readonly",
		);
		expect(result.inputs).toHaveProperty("clientJsonContents");
	});
});

describe("console_client phase B (import)", () => {
	it("imports pasted contents and completes", async () => {
		const ctx = ctxWith();
		const result = await consoleClient.run(ctx, emptyState(), {
			clientJsonContents: VALID_JSON,
		});

		expect(result.status).toBe("completed");
		const stored = JSON.parse((await ctx.keychain.get(SERVICE_CLIENT)) ?? "{}");
		expect(stored.clientId).toBe("abc.apps.googleusercontent.com");
	});

	it("prefers pasted contents over a path", async () => {
		const readFile = vi.fn(async () => "should not be read");
		const ctx = ctxWith({
			fs: { exists: async () => true, readFile, unlink: async () => {} },
		});
		const result = await consoleClient.run(ctx, emptyState(), {
			clientJsonContents: VALID_JSON,
			clientJsonPath: "/Users/tester/Downloads/client_secret.json",
		});
		expect(result.status).toBe("completed");
		expect(readFile).not.toHaveBeenCalled();
	});

	it("imports from a path and asks for delete consent", async () => {
		const state = emptyState();
		const result = await consoleClient.run(ctxWith(), state, {
			clientJsonPath: "/Users/tester/Downloads/client_secret.json",
		});

		expect(result.status).toBe("action_required");
		expect(state.pendingClientFileDelete).toBe(
			"/Users/tester/Downloads/client_secret.json",
		);
		expect(result.inputs).toEqual({
			confirmDeleteFile:
				"true to delete the plaintext client JSON, false to keep it",
		});
		// The step is not complete until the deletion decision is made.
		const ctx = ctxWith();
		await ctx.keychain.set(SERVICE_CLIENT, "{}");
		expect(await consoleClient.isComplete(ctx, state)).toBe(false);
	});

	it("deletes the plaintext on confirmDeleteFile: true", async () => {
		const unlink = vi.fn(async () => {});
		const ctx = ctxWith({
			fs: { exists: async () => true, readFile: async () => "", unlink },
		});
		const state = {
			...emptyState(),
			pendingClientFileDelete: "/Users/tester/Downloads/client_secret.json",
		};

		const result = await consoleClient.run(ctx, state, {
			confirmDeleteFile: true,
		});
		expect(result.status).toBe("completed");
		expect(unlink).toHaveBeenCalledWith(
			"/Users/tester/Downloads/client_secret.json",
		);
		expect(state.pendingClientFileDelete).toBeUndefined();
	});

	it("keeps the file on confirmDeleteFile: false with a warning", async () => {
		const unlink = vi.fn(async () => {});
		const ctx = ctxWith({
			fs: { exists: async () => true, readFile: async () => "", unlink },
		});
		const state = {
			...emptyState(),
			pendingClientFileDelete: "/Users/tester/Downloads/client_secret.json",
		};

		const result = await consoleClient.run(ctx, state, {
			confirmDeleteFile: false,
		});
		expect(result.status).toBe("completed");
		expect(unlink).not.toHaveBeenCalled();
		expect(result.instructions).toContain("recommend deleting");
	});

	it("deletes immediately when path and consent arrive together", async () => {
		const unlink = vi.fn(async () => {});
		const ctx = ctxWith({
			fs: { exists: async () => true, readFile: async () => VALID_JSON, unlink },
		});
		const state = emptyState();
		const result = await consoleClient.run(ctx, state, {
			clientJsonPath: "/Users/tester/Downloads/client_secret.json",
			confirmDeleteFile: true,
		});
		expect(result.status).toBe("completed");
		expect(unlink).toHaveBeenCalledOnce();
		expect(state.pendingClientFileDelete).toBeUndefined();
	});

	it("rejects non-Desktop JSON with the reason", async () => {
		const result = await consoleClient.run(ctxWith(), emptyState(), {
			clientJsonContents: JSON.stringify({ web: { client_id: "x" } }),
		});
		expect(result.status).toBe("failed");
		expect(result.instructions).toContain("Desktop-app");
	});

	it("fails cleanly on an unreadable path", async () => {
		const ctx = ctxWith({
			fs: {
				exists: async () => false,
				readFile: async () => {
					throw new Error("ENOENT");
				},
				unlink: async () => {},
			},
		});
		const result = await consoleClient.run(ctx, emptyState(), {
			clientJsonPath: "/nope.json",
		});
		expect(result.status).toBe("failed");
		expect(result.instructions).toContain("paste the JSON");
	});

	it("isComplete derives from the Keychain (ground truth)", async () => {
		const ctx = ctxWith();
		expect(await consoleClient.isComplete(ctx, emptyState())).toBe(false);
		await ctx.keychain.set(SERVICE_CLIENT, "{}");
		expect(await consoleClient.isComplete(ctx, emptyState())).toBe(true);
	});
});
