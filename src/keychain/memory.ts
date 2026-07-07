import type { KeychainStore } from "./store.js";

/** Map-backed store for unit tests and Docker CI. Never used at runtime. */
export class MemoryKeychain implements KeychainStore {
	private readonly entries = new Map<string, string>();

	async get(service: string): Promise<string | null> {
		return this.entries.get(service) ?? null;
	}

	async set(service: string, secret: string): Promise<void> {
		this.entries.set(service, secret);
	}

	async delete(service: string): Promise<void> {
		this.entries.delete(service);
	}
}
