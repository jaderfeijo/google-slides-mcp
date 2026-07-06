/**
 * Credential storage contract (PRD §6). Implementations must never let a
 * secret touch disk in plaintext or appear on a process argv.
 */
export interface KeychainStore {
	/** Returns the stored secret, or null when the entry does not exist. */
	get(service: string): Promise<string | null>;
	/** Creates or replaces the entry (upsert semantics). */
	set(service: string, secret: string): Promise<void>;
	/** Deletes the entry; resolves even when it does not exist. */
	delete(service: string): Promise<void>;
}

/** Thrown when the Keychain exists but access is denied (PRD §9). */
export class KeychainAccessDeniedError extends Error {
	readonly code = "KEYCHAIN_ACCESS_DENIED";
	constructor(detail: string) {
		super(
			`macOS Keychain access was denied (${detail}). ` +
				"Open Keychain Access.app, or re-approve the prompt and retry.",
		);
		this.name = "KeychainAccessDeniedError";
	}
}
