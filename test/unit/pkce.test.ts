import { describe, expect, it } from "vitest";

import { AuthFlowError, runPkceFlow } from "../../src/auth/pkce.js";
import type { ClientConfig } from "../../src/auth/types.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import { SERVICE_META, serviceForAccount } from "../../src/constants.js";

const CLIENT: ClientConfig = {
	clientId: "id.apps.googleusercontent.com",
	clientSecret: "secret",
};

/** Simulates the browser leg: hits the loopback callback like Google would. */
const browserStub =
	(params: (url: URL) => string) =>
	async (authUrl: string): Promise<void> => {
		const parsed = new URL(authUrl);
		const redirect = parsed.searchParams.get("redirect_uri");
		if (!redirect) throw new Error("no redirect_uri in auth URL");
		// Fire-and-forget like a real browser; the server resolves the flow.
		void fetch(`${redirect}?${params(parsed)}`);
	};

describe("runPkceFlow", () => {
	it("completes the loopback round trip and persists the account", async () => {
		const keychain = new MemoryKeychain();

		const record = await runPkceFlow(CLIENT, keychain, {
			tier: "core",
			openBrowser: browserStub(
				(url) => `code=auth-code-1&state=${url.searchParams.get("state")}`,
			),
			exchangeCode: async (code, verifier, redirectUri) => {
				expect(code).toBe("auth-code-1");
				expect(verifier.length).toBeGreaterThanOrEqual(43);
				expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
				return {
					refreshToken: "refresh-1",
					email: "user@example.com",
					grantedScopes: ["openid", "email"],
				};
			},
		});

		expect(record.email).toBe("user@example.com");
		expect(record.tier).toBe("core");

		const stored = await keychain.get(serviceForAccount("user@example.com"));
		expect(JSON.parse(stored ?? "{}").refreshToken).toBe("refresh-1");
		const meta = JSON.parse((await keychain.get(SERVICE_META)) ?? "{}");
		expect(meta.defaultAccount).toBe("user@example.com");
		expect(meta.schemaVersion).toBe(1);
	});

	it("keeps the existing default account when adding another", async () => {
		const keychain = new MemoryKeychain();
		await keychain.set(
			SERVICE_META,
			JSON.stringify({ defaultAccount: "first@example.com", schemaVersion: 1 }),
		);

		await runPkceFlow(CLIENT, keychain, {
			tier: "core",
			openBrowser: browserStub(
				(url) => `code=c&state=${url.searchParams.get("state")}`,
			),
			exchangeCode: async () => ({
				refreshToken: "r2",
				email: "second@example.com",
				grantedScopes: [],
			}),
		});

		const meta = JSON.parse((await keychain.get(SERVICE_META)) ?? "{}");
		expect(meta.defaultAccount).toBe("first@example.com");
	});

	it("rejects with AUTH_DENIED when the user declines consent", async () => {
		await expect(
			runPkceFlow(CLIENT, new MemoryKeychain(), {
				tier: "core",
				openBrowser: browserStub(() => "error=access_denied"),
			}),
		).rejects.toMatchObject({ code: "AUTH_DENIED" });
	});

	it("rejects on state mismatch (CSRF guard)", async () => {
		await expect(
			runPkceFlow(CLIENT, new MemoryKeychain(), {
				tier: "core",
				openBrowser: browserStub(() => "code=x&state=wrong"),
			}),
		).rejects.toMatchObject({ code: "AUTH_FAILED" });
	});

	it("times out cleanly when no callback arrives", async () => {
		await expect(
			runPkceFlow(CLIENT, new MemoryKeychain(), {
				tier: "core",
				timeoutMs: 200,
				openBrowser: async () => {},
			}),
		).rejects.toBeInstanceOf(AuthFlowError);
	});

	it("requests offline access with consent and the tier scopes", async () => {
		let captured = "";
		await runPkceFlow(CLIENT, new MemoryKeychain(), {
			tier: "extended",
			openBrowser: async (url) => {
				captured = url;
				await browserStub(
					(u) => `code=c&state=${u.searchParams.get("state")}`,
				)(url);
			},
			exchangeCode: async () => ({
				refreshToken: "r",
				email: "e@x.com",
				grantedScopes: [],
			}),
		});

		const url = new URL(captured);
		expect(url.searchParams.get("access_type")).toBe("offline");
		expect(url.searchParams.get("prompt")).toBe("consent select_account");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toBeTruthy();
		expect(url.searchParams.get("scope")).toContain(
			"https://www.googleapis.com/auth/drive",
		);
	});
});
