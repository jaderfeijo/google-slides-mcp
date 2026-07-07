import { describe, expect, it, vi } from "vitest";
import type { slides_v1 } from "@googleapis/slides";

import { firstAccountAuth } from "../../src/setup/steps/first-account-auth.js";
import { MemoryStateStore } from "../../src/setup/state-store.js";
import { emptyState, type StepContext } from "../../src/setup/types.js";
import { AuthFlowError } from "../../src/auth/pkce.js";
import type { AccountRecord } from "../../src/auth/types.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import { SERVICE_CLIENT, SERVICE_META } from "../../src/constants.js";

const record = (tier: "core" | "extended"): AccountRecord => ({
	email: "slides@user.com",
	refreshToken: "r",
	scopes: [],
	tier,
	addedAt: "2026-07-07T00:00:00Z",
});

const fakeSlides = (overrides: Partial<Record<string, unknown>> = {}) =>
	({
		presentations: {
			create: vi.fn(async () => ({
				data: { presentationId: "smoke-deck-1", revisionId: "r1" },
			})),
			get: vi.fn(async () => ({ data: { presentationId: "smoke-deck-1" } })),
			...overrides,
		},
	}) as unknown as slides_v1.Slides;

const ctxWith = (overrides: Partial<StepContext> = {}): StepContext => {
	const keychain = new MemoryKeychain();
	return {
		keychain,
		state: new MemoryStateStore(),
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		fs: {
			exists: async () => false,
			readFile: async () => "",
			unlink: async () => {},
		},
		runAuthFlow: vi.fn(async (_c, kc, opts) => {
			const r = record(opts.tier);
			await kc.set(SERVICE_META, JSON.stringify({ defaultAccount: r.email }));
			return r;
		}) as never,
		getAccessToken: async () => "at-smoke",
		fetch: vi.fn(
			async () => new Response(null, { status: 200 }),
		) as unknown as typeof fetch,
		slides: () => fakeSlides(),
		platform: "darwin",
		homeDir: "/Users/tester",
		log: () => {},
		...overrides,
	};
};

const withClient = async (ctx: StepContext): Promise<StepContext> => {
	await ctx.keychain.set(
		SERVICE_CLIENT,
		JSON.stringify({ clientId: "id", clientSecret: "s" }),
	);
	return ctx;
};

describe("first_account_auth step", () => {
	it("fails when no OAuth client is configured", async () => {
		const result = await firstAccountAuth.run(ctxWith(), emptyState(), {});
		expect(result.status).toBe("failed");
		expect(result.instructions).toContain("console_client");
	});

	it("signs in, smoke-tests create→get→trash, and reports setupComplete", async () => {
		const trashCalls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchSpy = (async (url: RequestInfo | URL, init?: RequestInit) => {
			trashCalls.push({ url: String(url), init });
			return new Response(null, { status: 200 });
		}) as typeof fetch;
		const slides = fakeSlides();
		const ctx = await withClient(ctxWith({ fetch: fetchSpy, slides: () => slides }));
		const state = { ...emptyState(), projectId: "slides-mcp-abc123" };

		const result = await firstAccountAuth.run(ctx, state, {
			tier: "extended",
		});

		expect(result.status).toBe("completed");
		expect(result.setupComplete).toEqual({
			account: "slides@user.com",
			tier: "extended",
			projectId: "slides-mcp-abc123",
		});
		const create = (slides.presentations as never as {
			create: ReturnType<typeof vi.fn>;
		}).create;
		expect(create.mock.calls[0][0].requestBody.title).toContain(
			"safe to delete",
		);
		expect(trashCalls[0].url).toBe(
			"https://www.googleapis.com/drive/v3/files/smoke-deck-1",
		);
		expect(trashCalls[0].init?.method).toBe("PATCH");
		expect(trashCalls[0].init?.body).toBe('{"trashed":true}');
	});

	it("defaults to the core tier", async () => {
		const ctx = await withClient(ctxWith());
		const result = await firstAccountAuth.run(ctx, emptyState(), {});
		expect(result.status).toBe("completed");
		expect(result.setupComplete?.tier).toBe("core");
	});

	it("reports a declined sign-in conversationally", async () => {
		const ctx = await withClient(
			ctxWith({
				runAuthFlow: vi.fn(async () => {
					throw new AuthFlowError("AUTH_DENIED", "user declined");
				}) as never,
			}),
		);
		const result = await firstAccountAuth.run(ctx, emptyState(), {});
		expect(result.status).toBe("failed");
		expect(result.detail).toContain("AUTH_DENIED");
	});

	it("points a disabled-API smoke failure back at project_provisioning", async () => {
		const slides = fakeSlides({
			create: vi.fn(async () => {
				throw {
					message: "API not enabled",
					response: {
						status: 403,
						data: {
							error: {
								message: "Slides API has not been used in project 1 before or it is disabled",
								errors: [{ reason: "accessNotConfigured" }],
							},
						},
					},
				};
			}),
		});
		const ctx = await withClient(ctxWith({ slides: () => slides }));

		const result = await firstAccountAuth.run(ctx, emptyState(), {});
		expect(result.status).toBe("failed");
		expect(result.detail).toContain("API_NOT_ENABLED");
		expect(result.alternatives?.[0].nextCall?.step).toBe(
			"project_provisioning",
		);
	});

	it("isComplete derives from the meta record (ground truth)", async () => {
		const ctx = ctxWith();
		expect(await firstAccountAuth.isComplete(ctx, emptyState())).toBe(false);
		await ctx.keychain.set(SERVICE_META, "{}");
		expect(await firstAccountAuth.isComplete(ctx, emptyState())).toBe(true);
	});
});
