/**
 * Minimal raw-REST Drive helpers. Deliberately not @googleapis/drive: M2
 * needs exactly one endpoint, and the full generated client would add
 * several MB to the MCPB bundle (PRD §10). M3's lifecycle tools absorb
 * this module when they add the real package.
 */

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

/** Moves a file to the Drive trash. Works on both scope tiers for files
 * the tool created (`drive.file`). */
export async function trashFile(
	fetchFn: typeof globalThis.fetch,
	accessToken: string,
	fileId: string,
): Promise<void> {
	const response = await fetchFn(
		`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`,
		{
			method: "PATCH",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ trashed: true }),
		},
	);
	if (!response.ok) {
		throw new Error(
			`Drive trash failed (${response.status}): ${await response.text()}`,
		);
	}
}
