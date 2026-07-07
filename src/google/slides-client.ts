import { slides, type slides_v1 } from "@googleapis/slides";
import { OAuth2Client } from "google-auth-library";

/**
 * Per-call Slides client factory (PRD §3: constructed per tools/call, cheap,
 * keeps handlers stateless). The AuthManager supplies a valid access token;
 * this client never refreshes on its own.
 *
 * gaxios retry stays on its safe defaults (429/5xx with exponential backoff
 * and jitter, idempotent methods only) — batchUpdate POSTs are deliberately
 * not auto-retried, so a quota error after retries surfaces to Claude with
 * the reset window instead of double-applying writes (PRD §9).
 */
export type SlidesClientFactory = (accessToken: string) => slides_v1.Slides;

export function createSlidesClient(accessToken: string): slides_v1.Slides {
	const auth = new OAuth2Client();
	auth.setCredentials({ access_token: accessToken });
	return slides({
		version: "v1",
		auth,
		retry: true,
		retryConfig: { retry: 3 },
	});
}
