import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AuthExpiredError } from "../../src/auth/manager.js";
import { AuthFlowError } from "../../src/auth/pkce.js";
import { KeychainAccessDeniedError } from "../../src/keychain/store.js";
import { translateGoogleError } from "../../src/errors.js";

const fixture = async (name: string): Promise<unknown> =>
	JSON.parse(
		await readFile(
			join(__dirname, "..", "fixtures", "errors", `${name}.json`),
			"utf8",
		),
	);

describe("translateGoogleError", () => {
	it("maps disabled-API 403s to API_NOT_ENABLED", async () => {
		const result = translateGoogleError(await fixture("403-service-disabled"));
		expect(result.code).toBe("API_NOT_ENABLED");
		expect(result.hint).toContain("gcloud services enable");
		expect(result.retriable).toBe(false);
	});

	it("maps scope 403s to INSUFFICIENT_SCOPE with the upgrade hint", async () => {
		const result = translateGoogleError(
			await fixture("403-insufficient-scope"),
		);
		expect(result.code).toBe("INSUFFICIENT_SCOPE");
		expect(result.hint).toContain('tier: "extended"');
	});

	it("maps 404 to NOT_FOUND", async () => {
		const result = translateGoogleError(await fixture("404-not-found"));
		expect(result.code).toBe("NOT_FOUND");
	});

	it("maps 429 to retriable RATE_LIMITED with the reset window", async () => {
		const result = translateGoogleError(await fixture("429-rate-limited"));
		expect(result.code).toBe("RATE_LIMITED");
		expect(result.retriable).toBe(true);
		expect(result.details).toEqual({ resetHint: "retry after 32s" });
	});

	it("passes batchUpdate 400s through with the failing index", async () => {
		const result = translateGoogleError(await fixture("400-batch-update"));
		expect(result.code).toBe("INVALID_REQUEST");
		expect(result.message).toContain("requests[3].createSlide");
	});

	it("maps invalid_grant token responses to AUTH_EXPIRED", async () => {
		const result = translateGoogleError(await fixture("401-invalid-grant"));
		expect(result.code).toBe("AUTH_EXPIRED");
		expect(result.message).toContain("invalid_grant");
	});

	it("maps 401 to AUTH_EXPIRED", () => {
		const result = translateGoogleError({
			message: "Invalid Credentials",
			response: { status: 401, data: {} },
		});
		expect(result.code).toBe("AUTH_EXPIRED");
		expect(result.hint).toContain("authenticate_account");
	});

	it("marks 5xx as retriable INTERNAL", () => {
		const result = translateGoogleError({
			message: "Backend Error",
			response: { status: 503, data: {} },
		});
		expect(result.code).toBe("INTERNAL");
		expect(result.retriable).toBe(true);
	});

	it("passes structured app errors straight through", () => {
		expect(
			translateGoogleError(new AuthExpiredError("a@b.com", "revoked")).code,
		).toBe("AUTH_EXPIRED");
		expect(
			translateGoogleError(new AuthFlowError("AUTH_TIMEOUT", "timed out"))
				.code,
		).toBe("AUTH_TIMEOUT");
		expect(
			translateGoogleError(new KeychainAccessDeniedError("locked")).code,
		).toBe("KEYCHAIN_ACCESS_DENIED");
	});

	it("never returns a raw stack for unknown errors", () => {
		const result = translateGoogleError(new RangeError("boom"));
		expect(result.code).toBe("INTERNAL");
		expect(result.message).toBe("boom");
	});
});
