import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import { SERVICE_CLIENT, SERVICE_META } from "../../src/constants.js";

const clientJson = {
	installed: {
		client_id: "id.apps.googleusercontent.com",
		client_secret: "s3cret",
		project_id: "slides-mcp-test",
	},
};

const writeClientFile = async (content: unknown): Promise<string> => {
	const dir = await mkdtemp(join(tmpdir(), "slides-mcp-cli-"));
	const path = join(dir, "client_secret_test.json");
	await writeFile(path, JSON.stringify(content));
	return path;
};

afterEach(() => vi.restoreAllMocks());

describe("cli auth import", () => {
	it("validates and stores a Desktop-app client JSON", async () => {
		const keychain = new MemoryKeychain();
		const path = await writeClientFile(clientJson);

		expect(await main(["auth", "import", path], keychain)).toBe(0);

		const stored = JSON.parse((await keychain.get(SERVICE_CLIENT)) ?? "{}");
		expect(stored.clientId).toBe("id.apps.googleusercontent.com");
		expect(stored.clientSecret).toBe("s3cret");
		expect(stored.projectId).toBe("slides-mcp-test");
	});

	it("rejects a non-Desktop client JSON", async () => {
		const keychain = new MemoryKeychain();
		const path = await writeClientFile({ web: { client_id: "x" } });

		expect(await main(["auth", "import", path], keychain)).toBe(1);
		expect(await keychain.get(SERVICE_CLIENT)).toBeNull();
	});
});

describe("cli auth login", () => {
	it("fails cleanly when no client is imported yet", async () => {
		expect(await main(["auth", "login"], new MemoryKeychain())).toBe(1);
	});

	it("rejects an unknown tier", async () => {
		const keychain = new MemoryKeychain();
		await keychain.set(SERVICE_CLIENT, JSON.stringify({ clientId: "a" }));
		expect(await main(["auth", "login", "--tier", "mega"], keychain)).toBe(1);
	});
});

describe("cli auth status", () => {
	it("reports unconfigured state without throwing", async () => {
		expect(await main(["auth", "status"], new MemoryKeychain())).toBe(0);
	});
});

describe("cli auth remove", () => {
	it("revokes with Google, deletes the entry, and clears the default", async () => {
		const keychain = new MemoryKeychain();
		await keychain.set(
			SERVICE_META,
			JSON.stringify({ defaultAccount: "a@b.com", schemaVersion: 1 }),
		);
		await keychain.set(
			"slides-mcp.account.a@b.com",
			JSON.stringify({
				email: "a@b.com",
				refreshToken: "refresh-a",
				scopes: [],
				tier: "core",
				addedAt: "2026-07-07T00:00:00Z",
			}),
		);
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 200 }));

		expect(await main(["auth", "remove"], keychain)).toBe(0);

		expect(fetchMock).toHaveBeenCalledOnce();
		const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
		expect(body.get("token")).toBe("refresh-a");
		expect(await keychain.get("slides-mcp.account.a@b.com")).toBeNull();
		expect(await keychain.get(SERVICE_META)).toBeNull();
	});

	it("keeps the entry when revocation hard-fails", async () => {
		const keychain = new MemoryKeychain();
		await keychain.set(
			SERVICE_META,
			JSON.stringify({ defaultAccount: "a@b.com", schemaVersion: 1 }),
		);
		await keychain.set(
			"slides-mcp.account.a@b.com",
			JSON.stringify({
				email: "a@b.com",
				refreshToken: "refresh-a",
				scopes: [],
				tier: "core",
				addedAt: "2026-07-07T00:00:00Z",
			}),
		);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(null, { status: 503 }),
		);

		expect(await main(["auth", "remove"], keychain)).toBe(1);
		expect(await keychain.get("slides-mcp.account.a@b.com")).not.toBeNull();
	});
});

describe("cli usage", () => {
	it("prints usage and succeeds with no arguments", async () => {
		expect(await main([], new MemoryKeychain())).toBe(0);
	});

	it("fails on unknown commands", async () => {
		expect(await main(["auth", "explode"], new MemoryKeychain())).toBe(1);
	});
});
