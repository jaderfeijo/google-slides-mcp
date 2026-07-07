import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { slides_v1 } from "@googleapis/slides";

import { AuthManager } from "../../src/auth/manager.js";
import { MemoryKeychain } from "../../src/keychain/memory.js";
import {
	registerTools,
	type AnyToolDefinition,
	type ToolDeps,
} from "../../src/tools/register.js";
import { createPresentation } from "../../src/tools/create-presentation.js";
import { getPresentation } from "../../src/tools/get-presentation.js";
import { batchUpdate } from "../../src/tools/batch-update.js";
import {
	SERVICE_CLIENT,
	SERVICE_META,
	serviceForAccount,
} from "../../src/constants.js";

const fixture = async (name: string): Promise<never> =>
	JSON.parse(
		await readFile(join(__dirname, "..", "fixtures", `${name}.json`), "utf8"),
	) as never;

/** Fake slides_v1.Slides with just the three M1 endpoints. */
const fakeSlides = (data: {
	create?: unknown;
	get?: unknown;
	batchUpdate?: unknown;
}) => {
	const presentations = {
		create: vi.fn(async () => ({ data: data.create })),
		get: vi.fn(async () => ({ data: data.get })),
		batchUpdate: vi.fn(async () => ({ data: data.batchUpdate })),
	};
	return {
		client: { presentations } as unknown as slides_v1.Slides,
		presentations,
	};
};

const configuredDeps = async (
	slides: slides_v1.Slides,
): Promise<ToolDeps> => {
	const keychain = new MemoryKeychain();
	await keychain.set(
		SERVICE_CLIENT,
		JSON.stringify({ clientId: "id", clientSecret: "s" }),
	);
	await keychain.set(
		SERVICE_META,
		JSON.stringify({ defaultAccount: "a@b.com", schemaVersion: 1 }),
	);
	await keychain.set(
		serviceForAccount("a@b.com"),
		JSON.stringify({
			email: "a@b.com",
			refreshToken: "r",
			scopes: [],
			tier: "core",
			addedAt: "2026-07-07T00:00:00Z",
		}),
	);
	const auth = new AuthManager(keychain, async () => ({
		accessToken: "at-1",
		expiresAt: Date.now() + 3_600_000,
	}));
	return { keychain, auth, slides: () => slides };
};

describe("create_presentation", () => {
	it("creates and returns id, revision, and a docs URL", async () => {
		const { client, presentations } = fakeSlides({
			create: await fixture("presentations.create"),
		});
		const deps = await configuredDeps(client);

		const result = (await createPresentation.handler(deps, {
			title: "Q3 Partner Proposal",
			locale: "en",
		})) as Record<string, unknown>;

		expect(presentations.create).toHaveBeenCalledWith({
			requestBody: { title: "Q3 Partner Proposal", locale: "en" },
		});
		expect(result.presentationId).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz");
		expect(result.revisionId).toBe("rev-1");
		expect(result.url).toBe(
			"https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit",
		);
	});
});

describe("get_presentation", () => {
	it("passes the fields mask through and returns the deck JSON", async () => {
		const { client, presentations } = fakeSlides({
			get: await fixture("presentations.get"),
		});
		const deps = await configuredDeps(client);

		const result = (await getPresentation.handler(deps, {
			presentationId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
			fields: "presentationId,revisionId",
		})) as Record<string, unknown>;

		expect(presentations.get).toHaveBeenCalledWith({
			presentationId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
			fields: "presentationId,revisionId",
		});
		expect(result.revisionId).toBe("rev-7");
	});
});

describe("batch_update", () => {
	it("passes requests and writeControl through, returns ids and revision", async () => {
		const { client, presentations } = fakeSlides({
			batchUpdate: await fixture("presentations.batchUpdate"),
		});
		const deps = await configuredDeps(client);
		const requests = [{ createSlide: { objectId: "slide-2" } }];

		const result = (await batchUpdate.handler(deps, {
			presentationId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
			requests,
			requiredRevisionId: "rev-7",
		})) as Record<string, unknown>;

		expect(presentations.batchUpdate).toHaveBeenCalledWith({
			presentationId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
			requestBody: {
				requests,
				writeControl: { requiredRevisionId: "rev-7" },
			},
		});
		expect(result.revisionId).toBe("rev-8");
		expect(result.objectIds).toEqual(["slide-2", "shape-9"]);
	});
});

describe("registerTools wrapper", () => {
	type Handler = (args: Record<string, unknown>) => Promise<{
		content: Array<{ type: string; text: string }>;
		isError?: boolean;
	}>;

	const capture = (tools: AnyToolDefinition[], deps: ToolDeps) => {
		const handlers = new Map<string, Handler>();
		const server = {
			registerTool: (name: string, _config: unknown, handler: Handler) => {
				handlers.set(name, handler);
			},
		};
		registerTools(server as never, deps, tools);
		return handlers;
	};

	it("returns the structured setup_required payload when unconfigured", async () => {
		const deps: ToolDeps = {
			keychain: new MemoryKeychain(),
			auth: new AuthManager(new MemoryKeychain(), async () => {
				throw new Error("unreachable");
			}),
			slides: () => fakeSlides({}).client,
		};
		const handlers = capture([createPresentation], deps);

		const result = await handlers.get("create_presentation")!({ title: "x" });
		const payload = JSON.parse(result.content[0].text);
		expect(result.isError).toBeUndefined();
		expect(payload.status).toBe("setup_required");
		expect(payload.next_steps).toContain("auth login");
	});

	it("translates Google errors into structured isError results", async () => {
		const { client, presentations } = fakeSlides({});
		presentations.get.mockRejectedValue({
			message: "not found",
			response: { status: 404, data: {} },
		});
		const deps = await configuredDeps(client);
		const handlers = capture([getPresentation], deps);

		const result = await handlers.get("get_presentation")!({
			presentationId: "missing",
		});
		expect(result.isError).toBe(true);
		const payload = JSON.parse(result.content[0].text);
		expect(payload.code).toBe("NOT_FOUND");
	});
});
