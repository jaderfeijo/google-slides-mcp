import { describe, expect, it } from "vitest";

import {
	SCOPES_CORE,
	SERVICE_CLIENT,
	scopesForTier,
	serviceForAccount,
} from "../../src/constants.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import { setupRequired } from "../../src/unconfigured.js";

describe("constants", () => {
	it("derives keychain service names per PRD §6", () => {
		expect(SERVICE_CLIENT).toBe("slides-mcp.client");
		expect(serviceForAccount("a@b.com")).toBe("slides-mcp.account.a@b.com");
	});

	it("core tier includes identity scopes and no broad drive", () => {
		const scopes = scopesForTier("core");
		expect(scopes).toContain("openid");
		expect(scopes).toEqual(expect.arrayContaining(SCOPES_CORE));
		expect(scopes).not.toContain("https://www.googleapis.com/auth/drive");
	});

	it("extended tier adds drive and spreadsheets.readonly", () => {
		const scopes = scopesForTier("extended");
		expect(scopes).toContain("https://www.googleapis.com/auth/drive");
		expect(scopes).toContain(
			"https://www.googleapis.com/auth/spreadsheets.readonly",
		);
	});
});

describe("MemoryKeychain", () => {
	it("round-trips and deletes entries", async () => {
		const kc = new MemoryKeychain();
		expect(await kc.get("svc")).toBeNull();
		await kc.set("svc", "secret");
		expect(await kc.get("svc")).toBe("secret");
		await kc.delete("svc");
		expect(await kc.get("svc")).toBeNull();
	});
});

describe("unconfigured mode", () => {
	it("returns a structured setup_required payload, never opaque", () => {
		const payload = setupRequired("no OAuth client configured");
		expect(payload.status).toBe("setup_required");
		expect(payload.next_steps).toContain("cli.js auth");
	});
});
