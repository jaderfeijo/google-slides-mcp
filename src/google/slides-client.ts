import type { slides_v1 } from "@googleapis/slides";

/**
 * Per-call Slides client factory (PRD §3: constructed per tools/call, cheap,
 * keeps handlers stateless).
 *
 * Contract for the implementation (issue #15): wraps @googleapis/slides with
 * the cached access token and gaxios retry (exponential backoff + jitter on
 * 429/5xx, PRD §9).
 */
export type SlidesClientFactory = (accessToken: string) => slides_v1.Slides;

export function createSlidesClient(_accessToken: string): slides_v1.Slides {
	throw new Error("Not implemented yet — tracked in issue #15");
}
