import { afterAll, describe, expect, it } from "vitest";

import { SecurityCliKeychain } from "../../src/keychain/security-cli.js";

// Real login-keychain round trip. macOS only, and opt-in because it touches
// the developer's actual Keychain (throwaway service names, cleaned up).
const enabled =
	process.platform === "darwin" &&
	process.env.SLIDES_MCP_KEYCHAIN_TESTS === "1";

const service = `slides-mcp-test.${Math.random().toString(36).slice(2)}`;

describe.skipIf(!enabled)("SecurityCliKeychain (real Keychain)", () => {
	const kc = new SecurityCliKeychain();

	afterAll(async () => {
		await kc.delete(service);
	});

	it("returns null for a missing entry", async () => {
		expect(await kc.get(service)).toBeNull();
	});

	it("round-trips a JSON secret with special characters", async () => {
		const secret = JSON.stringify({
			refreshToken: "1//tok en+with/special'chars\"",
			addedAt: new Date().toISOString(),
		});
		await kc.set(service, secret);
		expect(await kc.get(service)).toBe(secret);
	});

	it("upserts on repeated set", async () => {
		await kc.set(service, "first");
		await kc.set(service, "second");
		expect(await kc.get(service)).toBe("second");
	});

	it("deletes idempotently", async () => {
		await kc.delete(service);
		await kc.delete(service);
		expect(await kc.get(service)).toBeNull();
	});
});
