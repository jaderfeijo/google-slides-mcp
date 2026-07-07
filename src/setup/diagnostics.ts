import { join } from "node:path";

import type { AccountRecord, MetaRecord } from "../auth/types.js";
import {
	CONFIG_DIR_SUFFIX,
	SERVICE_CLIENT,
	SERVICE_META,
	TEMPLATES_FILE,
	consoleAuthUrl,
	serviceForAccount,
} from "../constants.js";
import { KeychainAccessDeniedError, type KeychainStore } from "../keychain/store.js";
import type { SetupStateStore } from "./state-store.js";
import type { SetupFs } from "./types.js";

export interface DiagnosticCheck {
	id: string;
	status: "pass" | "fail" | "warn" | "skipped";
	detail: string;
	fix?: {
		code: string;
		instructions: string;
		nextCall?: { tool: string; inputs?: Record<string, unknown> };
	};
}

export interface DiagnosticsReport {
	overall: "healthy" | "issues_found";
	checks: DiagnosticCheck[];
}

export interface DiagnosticsContext {
	keychain: KeychainStore;
	state: SetupStateStore;
	/** Must bypass any token cache — a live refresh proves the grant. */
	refreshAccessToken: (account: string) => Promise<string>;
	fetch: typeof globalThis.fetch;
	fs: SetupFs;
	homeDir: string;
	now: () => number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const PROBE_ID = "slides-mcp-diagnostic-probe";
const SLIDES_PROBE_URL = `https://slides.googleapis.com/v1/presentations/${PROBE_ID}`;
const DRIVE_PROBE_URL = `https://www.googleapis.com/drive/v3/files/${PROBE_ID}`;

/** Post-setup health checks (PRD §5.2). Every check is isolated; every
 * failure maps to a structured, named fix Claude can relay or execute. */
export class Diagnostics {
	constructor(private readonly ctx: DiagnosticsContext) {}

	async run(account?: string): Promise<DiagnosticsReport> {
		const checks: DiagnosticCheck[] = [];

		// 1. Keychain readable — a denial short-circuits everything else.
		let meta: MetaRecord | undefined;
		try {
			const rawMeta = await this.ctx.keychain.get(SERVICE_META);
			meta = rawMeta ? (JSON.parse(rawMeta) as MetaRecord) : undefined;
			checks.push({
				id: "keychain_readable",
				status: "pass",
				detail: "macOS Keychain is readable",
			});
		} catch (err) {
			checks.push({
				id: "keychain_readable",
				status: "fail",
				detail:
					err instanceof KeychainAccessDeniedError
						? err.message
						: `keychain read failed: ${err instanceof Error ? err.message : err}`,
				fix: {
					code: "KEYCHAIN_ACCESS_DENIED",
					instructions:
						"Approve the macOS Keychain prompt (it can appear after app " +
						"updates), or open Keychain Access.app and unlock the login " +
						"keychain, then run diagnostics again.",
				},
			});
			for (const id of [
				"client_configured",
				"account_refresh",
				"apis_enabled",
				"consent_testing_status",
				"template_registry",
			]) {
				checks.push({
					id,
					status: "skipped",
					detail: "skipped: keychain unreadable",
				});
			}
			return report(checks);
		}

		// 2. OAuth client present.
		const rawClient = await this.ctx.keychain.get(SERVICE_CLIENT);
		const clientOk = Boolean(rawClient);
		checks.push(
			clientOk
				? {
						id: "client_configured",
						status: "pass",
						detail: "OAuth client present in the Keychain",
					}
				: {
						id: "client_configured",
						status: "fail",
						detail: "no OAuth client in the Keychain",
						fix: {
							code: "SETUP_REQUIRED",
							instructions:
								"Re-run the console step of guided setup to create and " +
								"import the OAuth client.",
							nextCall: {
								tool: "run_setup_step",
								inputs: { step: "console_client" },
							},
						},
					},
		);

		// 3. Refresh-token health per account.
		const target = account ?? meta?.defaultAccount;
		let accessToken: string | undefined;
		let refreshError: string | undefined;
		let record: AccountRecord | undefined;
		if (!target) {
			checks.push({
				id: "account_refresh",
				status: "skipped",
				detail: "no accounts configured",
				fix: {
					code: "SETUP_REQUIRED",
					instructions: "Run guided setup to connect a Google account.",
					nextCall: { tool: "get_setup_status" },
				},
			});
		} else {
			const rawRecord = await this.ctx.keychain.get(serviceForAccount(target));
			record = rawRecord ? (JSON.parse(rawRecord) as AccountRecord) : undefined;
			try {
				accessToken = await this.ctx.refreshAccessToken(target);
				checks.push({
					id: "account_refresh",
					status: "pass",
					detail: `${target}: refresh token accepted by Google`,
				});
			} catch (err) {
				refreshError = err instanceof Error ? err.message : String(err);
				const deletedClient = /deleted_client|invalid_client/i.test(refreshError);
				checks.push({
					id: "account_refresh",
					status: "fail",
					detail: `${target}: ${refreshError}`,
					fix: deletedClient
						? {
								code: "OAUTH_CLIENT_DELETED",
								instructions:
									"Google no longer recognises the OAuth client (it may " +
									"have been auto-deleted after 6 months of inactivity). " +
									"Re-run only the console step to create a new client, " +
									"then re-authenticate the account.",
								nextCall: {
									tool: "run_setup_step",
									inputs: { step: "console_client" },
								},
							}
						: {
								code: "AUTH_EXPIRED",
								instructions: `Re-authenticate ${target} (the refresh token was revoked or expired).`,
								nextCall: {
									tool: "run_setup_step",
									inputs: { step: "first_account_auth" },
								},
							},
				});
			}
		}

		// 4. APIs enabled — live probes; 404 proves enabled, 403 disabled.
		if (!accessToken) {
			checks.push({
				id: "apis_enabled",
				status: "skipped",
				detail: "skipped: no valid access token to probe with",
			});
		} else {
			checks.push(await this.probeApis(accessToken));
		}

		// 5. Consent-screen-in-testing heuristic (PRD §9 row 3).
		const addedAgo = record ? this.ctx.now() - Date.parse(record.addedAt) : 0;
		if (
			refreshError &&
			/invalid_grant/i.test(refreshError) &&
			addedAgo >= SEVEN_DAYS_MS
		) {
			const state = await this.ctx.state.read();
			checks.push({
				id: "consent_testing_status",
				status: "warn",
				detail:
					"refresh failure ≥7 days after the account was added — the " +
					"signature of a consent screen left in Testing status",
				fix: {
					code: "CONSENT_SCREEN_IN_TESTING",
					instructions:
						`Open ${consoleAuthUrl("audience", state.projectId)} and set ` +
						"publishing status to In production, then re-authenticate the " +
						"account. Testing status expires all sign-ins after 7 days.",
				},
			});
		} else {
			checks.push({
				id: "consent_testing_status",
				status: refreshError ? "skipped" : "pass",
				detail: refreshError
					? "inconclusive: refresh failed for another reason or too recently"
					: "no testing-status signature detected",
			});
		}

		// 6. Template registry (structural only until M3).
		checks.push(await this.checkTemplates());

		return report(checks);
	}

	private async probeApis(accessToken: string): Promise<DiagnosticCheck> {
		const disabled: string[] = [];
		for (const [api, url] of [
			["Slides", SLIDES_PROBE_URL],
			["Drive", DRIVE_PROBE_URL],
		] as const) {
			try {
				const response = await this.ctx.fetch(url, {
					headers: { authorization: `Bearer ${accessToken}` },
				});
				if (response.status === 403) {
					const body = await response.text();
					if (/SERVICE_DISABLED|accessNotConfigured|has not been used/i.test(body)) {
						disabled.push(api);
					}
				}
				// 404 (or 200) proves the API is enabled and reachable.
			} catch {
				return {
					id: "apis_enabled",
					status: "skipped",
					detail: "inconclusive: network error while probing the APIs",
				};
			}
		}
		if (disabled.length > 0) {
			const state = await this.ctx.state.read();
			const project = state.projectId ? ` --project=${state.projectId}` : "";
			return {
				id: "apis_enabled",
				status: "fail",
				detail: `${disabled.join(" and ")} API disabled on the project`,
				fix: {
					code: "API_NOT_ENABLED",
					instructions:
						"Re-enable the APIs: re-run the project step of guided setup, " +
						`or run: gcloud services enable slides.googleapis.com drive.googleapis.com sheets.googleapis.com${project}`,
					nextCall: {
						tool: "run_setup_step",
						inputs: { step: "project_provisioning" },
					},
				},
			};
		}
		return {
			id: "apis_enabled",
			status: "pass",
			detail: "Slides and Drive APIs respond as enabled",
		};
	}

	private async checkTemplates(): Promise<DiagnosticCheck> {
		const path = join(this.ctx.homeDir, CONFIG_DIR_SUFFIX, TEMPLATES_FILE);
		if (!(await this.ctx.fs.exists(path))) {
			return {
				id: "template_registry",
				status: "skipped",
				detail: "no templates registered (registry ships with M3)",
			};
		}
		try {
			JSON.parse(await this.ctx.fs.readFile(path));
			return {
				id: "template_registry",
				status: "pass",
				detail: "templates.json parses",
			};
		} catch {
			return {
				id: "template_registry",
				status: "warn",
				detail: `templates.json at ${path} is not valid JSON`,
				fix: {
					code: "TEMPLATES_CORRUPT",
					instructions:
						"The template registry file is corrupt — fix or delete it " +
						"(it contains only friendly names and deck IDs, no secrets).",
				},
			};
		}
	}
}

const report = (checks: DiagnosticCheck[]): DiagnosticsReport => ({
	overall: checks.some((c) => c.status === "fail" || c.status === "warn")
		? "issues_found"
		: "healthy",
	checks,
});
