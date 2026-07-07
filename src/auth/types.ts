import type { ScopeTier } from "../constants.js";

/** Parsed Desktop-app OAuth client JSON, stored at slides-mcp.client (PRD §6). */
export interface ClientConfig {
	clientId: string;
	clientSecret: string;
	projectId?: string;
}

/** One Google account, stored at slides-mcp.account.<email> (PRD §6). */
export interface AccountRecord {
	email: string;
	refreshToken: string;
	scopes: string[];
	tier: ScopeTier;
	addedAt: string;
}

/** Stored at slides-mcp.meta (PRD §6). */
export interface MetaRecord {
	defaultAccount: string;
	schemaVersion: number;
}
