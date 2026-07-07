import { describe, expect, it } from "vitest";

import {
	Diagnostics,
	type DiagnosticsContext,
} from "../../src/setup/diagnostics.js";
import { MemoryStateStore } from "../../src/setup/state-store.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import { KeychainAccessDeniedError } from "../../src/keychain/store.js";
import {
	SERVICE_CLIENT,
	SERVICE_META,
	serviceForAccount,
} from "../../src/constants.js";

const NOW = Date.parse("2026-07-07T12:00:00Z");

const seededKeychain = async (addedAt = "2026-07-01T00:00:00Z") => {
	const kc = new MemoryKeychain();
	await kc.set(SERVICE_CLIENT, JSON.stringify({ clientId: "id" }));
	await kc.set(
		SERVICE_META,
		JSON.stringify({ defaultAccount: "a@b.com", schemaVersion: 1 }),
	);
	await kc.set(
		serviceForAccount("a@b.com"),
		JSON.stringify({
			email: "a@b.com",
			refreshToken: "r",
			scopes: [],
			tier: "core",
			addedAt,
		}),
	);
	return kc;
};

const ctxWith = (
	overrides: Partial<DiagnosticsContext> = {},
): DiagnosticsContext => ({
	keychain: new MemoryKeychain(),
	state: new MemoryStateStore(),
	refreshAccessToken: async () => "at-fresh",
	fetch: (async () => new Response(null, { status: 404 })) as typeof fetch,
	fs: {
		exists: async () => false,
		readFile: async () => "",
		unlink: async () => {},
	},
	homeDir: "/Users/tester",
	now: () => NOW,
	...overrides,
});

const check = (report: { checks: Array<{ id: string }> }, id: string) =>
	(report.checks as Array<{ id: string; status: string; detail: string; fix?: { code: string; nextCall?: { inputs?: Record<string, unknown> } } }>).find(
		(c) => c.id === id,
	);

describe("Diagnostics", () => {
	it("reports healthy on a fully working install", async () => {
		const diagnostics = new Diagnostics(
			ctxWith({ keychain: await seededKeychain() }),
		);
		const report = await diagnostics.run();
		expect(report.overall).toBe("healthy");
		expect(report.checks.every((c) => c.status !== "fail")).toBe(true);
	});

	it("short-circuits everything on keychain denial", async () => {
		const keychain = new MemoryKeychain();
		keychain.get = async () => {
			throw new KeychainAccessDeniedError("locked");
		};
		const report = await new Diagnostics(ctxWith({ keychain })).run();

		expect(check(report, "keychain_readable")?.status).toBe("fail");
		expect(check(report, "keychain_readable")?.fix?.code).toBe(
			"KEYCHAIN_ACCESS_DENIED",
		);
		expect(check(report, "apis_enabled")?.status).toBe("skipped");
		expect(report.overall).toBe("issues_found");
	});

	it("flags a missing client with the console-step fix", async () => {
		const keychain = await seededKeychain();
		await keychain.delete(SERVICE_CLIENT);
		const report = await new Diagnostics(
			ctxWith({ keychain }),
		).run();

		const c = check(report, "client_configured");
		expect(c?.status).toBe("fail");
		expect(c?.fix?.nextCall?.inputs).toEqual({ step: "console_client" });
	});

	it("maps invalid_grant to AUTH_EXPIRED naming the account", async () => {
		const report = await new Diagnostics(
			ctxWith({
				keychain: await seededKeychain("2026-07-07T11:00:00Z"),
				refreshAccessToken: async () => {
					throw new Error("invalid_grant: revoked");
				},
			}),
		).run();

		const c = check(report, "account_refresh");
		expect(c?.status).toBe("fail");
		expect(c?.detail).toContain("a@b.com");
		expect(c?.fix?.code).toBe("AUTH_EXPIRED");
		// Added an hour ago — no testing-status signature.
		expect(check(report, "consent_testing_status")?.status).toBe("skipped");
	});

	it("detects the deleted-client signature", async () => {
		const report = await new Diagnostics(
			ctxWith({
				keychain: await seededKeychain(),
				refreshAccessToken: async () => {
					throw new Error("deleted_client: The OAuth client was deleted.");
				},
			}),
		).run();

		expect(check(report, "account_refresh")?.fix?.code).toBe(
			"OAUTH_CLIENT_DELETED",
		);
	});

	it("warns with the testing-status heuristic after 7 days", async () => {
		const report = await new Diagnostics(
			ctxWith({
				keychain: await seededKeychain("2026-06-25T00:00:00Z"),
				refreshAccessToken: async () => {
					throw new Error("invalid_grant: Token has been expired or revoked.");
				},
			}),
		).run();

		const c = check(report, "consent_testing_status");
		expect(c?.status).toBe("warn");
		expect(c?.fix?.code).toBe("CONSENT_SCREEN_IN_TESTING");
	});

	it("treats a 404 probe as API enabled and 403 SERVICE_DISABLED as not", async () => {
		const disabledBody = JSON.stringify({
			error: { status: "PERMISSION_DENIED", message: "SERVICE_DISABLED" },
		});
		const report = await new Diagnostics(
			ctxWith({
				keychain: await seededKeychain(),
				fetch: (async (url: RequestInfo | URL) =>
					String(url).includes("slides.googleapis.com")
						? new Response(disabledBody, { status: 403 })
						: new Response(null, { status: 404 })) as typeof fetch,
			}),
		).run();

		const c = check(report, "apis_enabled");
		expect(c?.status).toBe("fail");
		expect(c?.detail).toContain("Slides");
		expect(c?.detail).not.toContain("Drive and");
		expect(c?.fix?.code).toBe("API_NOT_ENABLED");
	});

	it("skips API probing without a valid token", async () => {
		const report = await new Diagnostics(
			ctxWith({
				keychain: await seededKeychain(),
				refreshAccessToken: async () => {
					throw new Error("invalid_grant");
				},
			}),
		).run();
		expect(check(report, "apis_enabled")?.status).toBe("skipped");
	});

	it("skips the template registry when absent and warns when corrupt", async () => {
		const healthy = await new Diagnostics(
			ctxWith({ keychain: await seededKeychain() }),
		).run();
		expect(check(healthy, "template_registry")?.status).toBe("skipped");

		const corrupt = await new Diagnostics(
			ctxWith({
				keychain: await seededKeychain(),
				fs: {
					exists: async () => true,
					readFile: async () => "{broken",
					unlink: async () => {},
				},
			}),
		).run();
		expect(check(corrupt, "template_registry")?.status).toBe("warn");
	});

	it("reports skipped account check when nothing is configured", async () => {
		const report = await new Diagnostics(ctxWith()).run();
		expect(check(report, "account_refresh")?.status).toBe("skipped");
		expect(check(report, "client_configured")?.status).toBe("fail");
	});
});
