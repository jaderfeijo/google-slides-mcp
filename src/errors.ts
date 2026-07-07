import { AuthExpiredError } from "./auth/manager.js";
import { AuthFlowError } from "./auth/pkce.js";
import { KeychainAccessDeniedError } from "./keychain/store.js";

/** Structured, actionable error shape returned to Claude (PRD §7.4). */
export interface ToolError {
	code:
		| "AUTH_EXPIRED"
		| "AUTH_TIMEOUT"
		| "AUTH_DENIED"
		| "AUTH_FAILED"
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

/** Duck-typed Gaxios/Google API error — avoids importing transitive deps. */
interface GoogleApiErrorLike {
	message?: string;
	response?: {
		status?: number;
		headers?: Record<string, unknown> | { get?(name: string): string | null };
		data?: {
			error?:
				| string
				| {
						code?: number;
						status?: string;
						message?: string;
						errors?: Array<{ reason?: string; message?: string }>;
						details?: unknown;
				  };
			error_description?: string;
		};
	};
}

const HINTS: Partial<Record<ToolError["code"], string>> = {
	AUTH_EXPIRED:
		"Re-authenticate this account (ask me to call authenticate_account, " +
		"or run: node dist/cli.js auth login).",
	INSUFFICIENT_SCOPE:
		"This operation needs the extended tier; ask me to call " +
		'authenticate_account with tier: "extended".',
	API_NOT_ENABLED:
		"Enable the API for your project: gcloud services enable " +
		"slides.googleapis.com drive.googleapis.com",
	NOT_FOUND:
		"Check the presentation ID; the deck may be deleted or this account " +
		"may lack access to it.",
	RATE_LIMITED: "Wait for the quota window to reset, then retry.",
	KEYCHAIN_ACCESS_DENIED:
		"Approve the macOS Keychain prompt (or open Keychain Access.app) and retry.",
};

const toolError = (
	code: ToolError["code"],
	message: string,
	retriable = false,
	details?: unknown,
): ToolError => ({
	code,
	message,
	hint: HINTS[code],
	retriable,
	...(details !== undefined ? { details } : {}),
});

/**
 * Maps auth/keychain/Google API failures to the structured ToolError shape
 * (PRD §7.4, §9). Raw stacks never reach Claude.
 */
export function translateGoogleError(err: unknown): ToolError {
	if (err instanceof AuthExpiredError) {
		return toolError("AUTH_EXPIRED", err.message);
	}
	if (err instanceof AuthFlowError) {
		return toolError(err.code, err.message);
	}
	if (err instanceof KeychainAccessDeniedError) {
		return toolError("KEYCHAIN_ACCESS_DENIED", err.message);
	}

	const apiError = err as GoogleApiErrorLike;
	const status = apiError.response?.status;
	const data = apiError.response?.data;
	const structured = typeof data?.error === "object" ? data.error : undefined;
	const message =
		structured?.message ??
		(typeof data?.error === "string"
			? `${data.error}: ${data.error_description ?? ""}`.trim()
			: undefined) ??
		apiError.message ??
		String(err);
	const reasons = (structured?.errors ?? [])
		.map((entry) => entry.reason)
		.filter(Boolean) as string[];
	const grpcStatus = structured?.status;

	if (status === undefined) {
		return toolError("INTERNAL", message);
	}

	if (status === 401 || /invalid_grant/i.test(message)) {
		return toolError("AUTH_EXPIRED", message);
	}
	if (status === 403) {
		if (
			reasons.includes("accessNotConfigured") ||
			/SERVICE_DISABLED|has not been used in project|is disabled/i.test(message)
		) {
			return toolError("API_NOT_ENABLED", message);
		}
		if (
			reasons.some((reason) => /rateLimit|quota/i.test(reason)) ||
			grpcStatus === "RESOURCE_EXHAUSTED"
		) {
			return toolError("RATE_LIMITED", message, true, {
				resetHint: retryAfter(apiError),
			});
		}
		return toolError("INSUFFICIENT_SCOPE", message);
	}
	if (status === 404) {
		return toolError("NOT_FOUND", message);
	}
	if (status === 429) {
		return toolError("RATE_LIMITED", message, true, {
			resetHint: retryAfter(apiError),
		});
	}
	if (status === 400) {
		// batchUpdate reports the failing request index in the message, e.g.
		// "Invalid requests[3].createSlide: ..." — pass it through verbatim.
		return toolError("INVALID_REQUEST", message, false, structured?.details);
	}
	if (status >= 500) {
		return toolError("INTERNAL", message, true);
	}
	return toolError("INTERNAL", message);
}

const retryAfter = (err: GoogleApiErrorLike): string => {
	const headers = err.response?.headers;
	if (!headers) return "unknown reset window";
	const value =
		typeof (headers as { get?(name: string): string | null }).get ===
		"function"
			? (headers as { get(name: string): string | null }).get("retry-after")
			: (headers as Record<string, unknown>)["retry-after"];
	return value ? `retry after ${String(value)}s` : "unknown reset window";
};
