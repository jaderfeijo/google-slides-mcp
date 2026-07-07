import { describe, expect, it } from "vitest";

import { GcloudCli } from "../../src/setup/gcloud.js";
import { probeBinary } from "../../src/setup/probe.js";
import type { ExecRunner, SetupFs } from "../../src/setup/types.js";

const fsWith = (existing: string[]): SetupFs => ({
	exists: async (path) => existing.includes(path),
	readFile: async () => "",
	unlink: async () => {},
});

describe("probeBinary", () => {
	it("returns the first existing candidate in order", async () => {
		const fs = fsWith(["/usr/local/bin/gcloud", "/opt/homebrew/bin/gcloud"]);
		expect(
			await probeBinary(fs, [
				"/opt/homebrew/bin/gcloud",
				"/usr/local/bin/gcloud",
			]),
		).toBe("/opt/homebrew/bin/gcloud");
	});

	it("returns undefined when nothing exists", async () => {
		expect(await probeBinary(fsWith([]), ["/a", "/b"])).toBeUndefined();
	});
});

describe("GcloudCli", () => {
	const capture = (
		responses: Array<{ code: number; stdout?: string; stderr?: string }>,
	) => {
		const calls: Array<{ command: string; args: string[]; timeoutMs?: number }> =
			[];
		let i = 0;
		const exec: ExecRunner = async (command, args, options) => {
			calls.push({ command, args, timeoutMs: options?.timeoutMs });
			const r = responses[Math.min(i++, responses.length - 1)];
			return { code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
		};
		return { calls, gcloud: new GcloudCli(exec, "/opt/homebrew/bin/gcloud") };
	};

	it("parses the active account", async () => {
		const { gcloud, calls } = capture([
			{ code: 0, stdout: "user@example.com\n" },
		]);
		expect(await gcloud.activeAccount()).toBe("user@example.com");
		expect(calls[0].args).toEqual([
			"auth",
			"list",
			"--filter=status:ACTIVE",
			"--format=value(account)",
		]);
	});

	it("returns undefined when no account is active", async () => {
		const { gcloud } = capture([{ code: 0, stdout: "\n" }]);
		expect(await gcloud.activeAccount()).toBeUndefined();
	});

	it("runs login with the 5-minute timeout", async () => {
		const { gcloud, calls } = capture([{ code: 0 }]);
		await gcloud.login();
		expect(calls[0].args).toEqual(["auth", "login", "--brief"]);
		expect(calls[0].timeoutMs).toBe(5 * 60 * 1000);
	});

	it("builds exact provisioning argv and records every command verbatim", async () => {
		const { gcloud, calls } = capture([{ code: 0 }]);
		await gcloud.createProject("slides-mcp-abc123");
		await gcloud.enableServices("slides-mcp-abc123");

		expect(calls[0].args).toEqual([
			"projects",
			"create",
			"slides-mcp-abc123",
			"--name=Slides MCP",
		]);
		expect(calls[1].args).toEqual([
			"services",
			"enable",
			"slides.googleapis.com",
			"drive.googleapis.com",
			"sheets.googleapis.com",
			"--project=slides-mcp-abc123",
		]);
		expect(gcloud.commands).toHaveLength(2);
		expect(gcloud.commands[0].command).toBe(
			"/opt/homebrew/bin/gcloud projects create slides-mcp-abc123 --name=Slides MCP",
		);
	});
});
