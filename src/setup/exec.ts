import { spawn } from "node:child_process";
import { access, readFile, unlink } from "node:fs/promises";

import type { ExecRunner, SetupFs } from "./types.js";

/** Spawns an absolute-path binary; kills the child on timeout so a stuck
 * `gcloud auth login` can never hang a tool call (PRD §9). */
export const defaultExecRunner: ExecRunner = (command, args, options) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = options?.timeoutMs
			? setTimeout(() => {
					timedOut = true;
					child.kill("SIGKILL");
				}, options.timeoutMs)
			: undefined;

		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
		child.on("error", (err) => {
			if (timer) clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolve({ code: code ?? 1, stdout, stderr, timedOut });
		});
	});

export const defaultSetupFs: SetupFs = {
	async exists(path) {
		try {
			await access(path);
			return true;
		} catch {
			return false;
		}
	},
	readFile: (path) => readFile(path, "utf8"),
	unlink: (path) => unlink(path),
};
