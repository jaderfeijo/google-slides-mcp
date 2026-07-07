import { spawn } from "node:child_process";

import { KEYCHAIN_ACCOUNT } from "../constants.js";
import { KeychainAccessDeniedError, type KeychainStore } from "./store.js";

const SECURITY = "/usr/bin/security";
/** `security` exit code for errSecItemNotFound. */
const NOT_FOUND = 44;

export interface SecurityResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Injectable in unit tests; the default spawns /usr/bin/security. */
export type SecurityRunner = (
	args: string[],
	stdin?: string,
) => Promise<SecurityResult>;

const defaultRunner: SecurityRunner = (args, stdin) =>
	new Promise((resolve, reject) => {
		const child = spawn(SECURITY, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
		if (stdin !== undefined) child.stdin.write(stdin);
		child.stdin.end();
	});

/**
 * macOS Keychain access via /usr/bin/security (PRD §6).
 *
 * Secrets never appear on a process argv: writes go through `security -i`
 * (commands on stdin). All payloads are base64-encoded before storage, so
 * stored values are plain ASCII with no quoting hazards.
 */
export class SecurityCliKeychain implements KeychainStore {
	constructor(private readonly run: SecurityRunner = defaultRunner) {}

	async get(service: string): Promise<string | null> {
		const result = await this.run([
			"find-generic-password",
			"-a",
			KEYCHAIN_ACCOUNT,
			"-s",
			service,
			"-w",
		]);
		if (result.code === NOT_FOUND) return null;
		if (result.code !== 0) throw denied("read", service, result);
		return Buffer.from(result.stdout.trim(), "base64").toString("utf8");
	}

	async set(service: string, secret: string): Promise<void> {
		const encoded = Buffer.from(secret, "utf8").toString("base64");
		const command =
			`add-generic-password -U -a ${KEYCHAIN_ACCOUNT} ` +
			`-s ${service} -w ${encoded}\n`;
		const result = await this.run(["-i"], command);
		if (result.code !== 0) throw denied("write", service, result);
	}

	async delete(service: string): Promise<void> {
		const result = await this.run([
			"delete-generic-password",
			"-a",
			KEYCHAIN_ACCOUNT,
			"-s",
			service,
		]);
		if (result.code !== 0 && result.code !== NOT_FOUND) {
			throw denied("delete", service, result);
		}
	}
}

const denied = (
	op: string,
	service: string,
	result: SecurityResult,
): KeychainAccessDeniedError =>
	new KeychainAccessDeniedError(
		`${op} of "${service}" failed, security exited ${result.code}: ` +
			result.stderr.trim(),
	);
