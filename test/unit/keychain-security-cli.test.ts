import { describe, expect, it, vi } from "vitest";

import {
	SecurityCliKeychain,
	type SecurityResult,
	type SecurityRunner,
} from "../../src/keychain/security-cli.js";
import { KeychainAccessDeniedError } from "../../src/keychain/store.js";

const ok = (stdout = ""): SecurityResult => ({ code: 0, stdout, stderr: "" });
const fail = (code: number, stderr = ""): SecurityResult => ({
	code,
	stdout: "",
	stderr,
});

describe("SecurityCliKeychain (faked runner)", () => {
	it("decodes base64 payloads on read", async () => {
		const secret = JSON.stringify({ token: "abc", nested: "va lue" });
		const encoded = Buffer.from(secret).toString("base64");
		const runner: SecurityRunner = vi.fn(async () => ok(`${encoded}\n`));
		const kc = new SecurityCliKeychain(runner);

		expect(await kc.get("slides-mcp.meta")).toBe(secret);
		expect(runner).toHaveBeenCalledWith([
			"find-generic-password",
			"-a",
			"slides-mcp",
			"-s",
			"slides-mcp.meta",
			"-w",
		]);
	});

	it("maps exit code 44 to null", async () => {
		const kc = new SecurityCliKeychain(async () => fail(44));
		expect(await kc.get("slides-mcp.client")).toBeNull();
	});

	it("throws KeychainAccessDeniedError on other read failures", async () => {
		const kc = new SecurityCliKeychain(async () => fail(51, "denied"));
		await expect(kc.get("slides-mcp.client")).rejects.toBeInstanceOf(
			KeychainAccessDeniedError,
		);
	});

	it("writes via `security -i` stdin, never argv, base64-encoded", async () => {
		const calls: Array<{ args: string[]; stdin?: string }> = [];
		const runner: SecurityRunner = async (args, stdin) => {
			calls.push({ args, stdin });
			return ok();
		};
		const kc = new SecurityCliKeychain(runner);
		const secret = 'refresh "token" with $pecial \'chars\'';
		await kc.set("slides-mcp.account.a@b.com", secret);

		expect(calls).toHaveLength(1);
		expect(calls[0].args).toEqual(["-i"]);
		// The secret must not leak into argv or stdin in plaintext.
		expect(calls[0].stdin).not.toContain(secret);
		const encoded = Buffer.from(secret).toString("base64");
		expect(calls[0].stdin).toBe(
			`add-generic-password -U -a slides-mcp -s slides-mcp.account.a@b.com -w ${encoded}\n`,
		);
	});

	it("delete tolerates missing entries (idempotent)", async () => {
		const kc = new SecurityCliKeychain(async () => fail(44));
		await expect(kc.delete("slides-mcp.meta")).resolves.toBeUndefined();
	});

	it("delete throws on real failures", async () => {
		const kc = new SecurityCliKeychain(async () => fail(1, "boom"));
		await expect(kc.delete("slides-mcp.meta")).rejects.toBeInstanceOf(
			KeychainAccessDeniedError,
		);
	});
});
