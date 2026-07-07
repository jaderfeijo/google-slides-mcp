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
			"Call the get_setup_status tool now, then guide the user through " +
			"the one-time setup with run_setup_step, narrating each step and " +
			"asking before anything that opens a browser, creates cloud " +
			"resources, or installs software. Setup takes about 10 minutes and " +
			"is resumable at any point.",
	};
}
