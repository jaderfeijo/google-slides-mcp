/**
 * Structured setup-required payload returned by every content tool while the
 * server is unconfigured (PRD §5, §9 row 1). Content tools never fail
 * opaquely. In M2 the next_steps text hands off to `get_setup_status`.
 */
export interface SetupRequiredPayload {
	status: "setup_required";
	message: string;
	next_steps: string;
}

export function setupRequired(detail: string): SetupRequiredPayload {
	return {
		status: "setup_required",
		message: `slides-mcp is installed but not yet connected to a Google account: ${detail}`,
		next_steps:
			"Guided setup is not available in this build. From a terminal, run:\n" +
			"  node dist/cli.js auth import <path-to-client_secret.json>\n" +
			"  node dist/cli.js auth login\n" +
			"See the README for creating the Google Cloud OAuth client.",
	};
}
