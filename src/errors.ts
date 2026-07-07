/** Structured, actionable error shape returned to Claude (PRD §7.4). */
export interface ToolError {
	code:
		| "AUTH_EXPIRED"
		| "INSUFFICIENT_SCOPE"
		| "API_NOT_ENABLED"
		| "NOT_FOUND"
		| "RATE_LIMITED"
		| "INVALID_REQUEST"
		| "KEYCHAIN_ACCESS_DENIED"
		| "SETUP_REQUIRED"
		| "INTERNAL";
	message: string;
	hint?: string;
	retriable: boolean;
	details?: unknown;
}

/**
 * Maps Google API / auth failures to ToolError (issue #11):
 * 401 invalid_grant → AUTH_EXPIRED; 403 insufficient scope →
 * INSUFFICIENT_SCOPE (extended-tier hint); 403 SERVICE_DISABLED →
 * API_NOT_ENABLED; 404 → NOT_FOUND; 429 after retries → RATE_LIMITED with
 * reset window; 400 batchUpdate → INVALID_REQUEST with failing index.
 */
export function translateGoogleError(err: unknown): ToolError {
	const message = err instanceof Error ? err.message : String(err);
	return { code: "INTERNAL", message, retriable: false };
}
