import { describe, expect, it, vi } from "vitest";

import {
	AuthExpiredError,
	AuthManager,
	NotConfiguredError,
	type TokenRefresher,
} from "../../src/auth/manager.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import {
	SERVICE_CLIENT,
	SERVICE_META,
	serviceForAccount,
} from "../../src/constants.js";

const seed = async (): Promise<MemoryKeychain> => {
	const kc = new MemoryKeychain();
	await kc.set(
		SERVICE_CLIENT,
		JSON.stringify({ clientId: "id", clientSecret: "secret" }),
	);
	await kc.set(
		SERVICE_META,
		JSON.stringify({ defaultAccount: "a@b.com", schemaVersion: 1 }),
	);
	await kc.set(
		serviceForAccount("a@b.com"),
		JSON.stringify({
			email: "a@b.com",
			refreshToken: "refresh-a",
			scopes: [],
			tier: "core",
			addedAt: "2026-07-07T00:00:00Z",
		}),
	);
	return kc;
};

describe("AuthManager", () => {
	it("refreshes via the stored refresh token for the default account", async () => {
		const refresher: TokenRefresher = vi.fn(async (client, refreshToken) => {
			expect(client.clientId).toBe("id");
			expect(refreshToken).toBe("refresh-a");
			return { accessToken: "at-1", expiresAt: Date.now() + 3_600_000 };
		});
		const mgr = new AuthManager(await seed(), refresher);

		expect(await mgr.getAccessToken()).toBe("at-1");
	});

	it("serves the in-memory cache within the expiry window", async () => {
		const refresher = vi.fn(async () => ({
			accessToken: "at-1",
			expiresAt: Date.now() + 3_600_000,
		}));
		const mgr = new AuthManager(await seed(), refresher);

		await mgr.getAccessToken();
		await mgr.getAccessToken();
		expect(refresher).toHaveBeenCalledTimes(1);
	});

	it("re-refreshes when the cached token is within the 60s skew", async () => {
		const refresher = vi.fn(async () => ({
			accessToken: "short-lived",
			expiresAt: Date.now() + 30_000, // inside the skew window
		}));
		const mgr = new AuthManager(await seed(), refresher);

		await mgr.getAccessToken();
		await mgr.getAccessToken();
		expect(refresher).toHaveBeenCalledTimes(2);
	});

	it("maps invalid_grant to AuthExpiredError naming the account", async () => {
		const mgr = new AuthManager(await seed(), async () => {
			throw new Error("invalid_grant: Token has been revoked");
		});

		const err = await mgr.getAccessToken().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(AuthExpiredError);
		expect((err as AuthExpiredError).account).toBe("a@b.com");
	});

	it("throws NotConfiguredError when nothing is set up", async () => {
		const mgr = new AuthManager(new MemoryKeychain(), async () => {
			throw new Error("unreachable");
		});
		await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(
			NotConfiguredError,
		);
	});

	it("throws NotConfiguredError for an unknown named account", async () => {
		const mgr = new AuthManager(await seed(), async () => ({
			accessToken: "x",
			expiresAt: Date.now() + 3_600_000,
		}));
		await expect(
			mgr.getAccessToken("nobody@example.com"),
		).rejects.toBeInstanceOf(NotConfiguredError);
	});

	it("caches per account, not globally", async () => {
		const kc = await seed();
		await kc.set(
			serviceForAccount("c@d.com"),
			JSON.stringify({
				email: "c@d.com",
				refreshToken: "refresh-c",
				scopes: [],
				tier: "core",
				addedAt: "2026-07-07T00:00:00Z",
			}),
		);
		const refresher = vi.fn(async (_c, refreshToken) => ({
			accessToken: `at-for-${refreshToken}`,
			expiresAt: Date.now() + 3_600_000,
		}));
		const mgr = new AuthManager(kc, refresher);

		expect(await mgr.getAccessToken("a@b.com")).toBe("at-for-refresh-a");
		expect(await mgr.getAccessToken("c@d.com")).toBe("at-for-refresh-c");
		expect(refresher).toHaveBeenCalledTimes(2);
	});
});
