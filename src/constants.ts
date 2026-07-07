export const APP_NAME = "slides-mcp";
export const SCHEMA_VERSION = 1;

// Keychain service names (PRD §6)
export const KEYCHAIN_ACCOUNT = APP_NAME;
export const SERVICE_CLIENT = `${APP_NAME}.client`;
export const SERVICE_META = `${APP_NAME}.meta`;
export const serviceForAccount = (email: string): string =>
	`${APP_NAME}.account.${email}`;

// OAuth scopes (PRD §4.4)
export const SCOPES_IDENTITY = ["openid", "email"];
export const SCOPES_CORE = [
	"https://www.googleapis.com/auth/presentations",
	"https://www.googleapis.com/auth/drive.file",
];
export const SCOPES_EXTENDED = [
	...SCOPES_CORE,
	"https://www.googleapis.com/auth/drive",
	"https://www.googleapis.com/auth/spreadsheets.readonly",
];

export type ScopeTier = "core" | "extended";

export const scopesForTier = (tier: ScopeTier): string[] => [
	...SCOPES_IDENTITY,
	...(tier === "extended" ? SCOPES_EXTENDED : SCOPES_CORE),
];

// OAuth endpoints
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Auth flow behaviour (PRD §4.3, §9)
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
export const LOOPBACK_PORT_RETRIES = 3;
export const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;

// Non-secret config files (PRD §6)
export const CONFIG_DIR_SUFFIX = ".config/slides-mcp";
export const SETUP_STATE_FILE = "state.json";
export const TEMPLATES_FILE = "templates.json";

// Setup engine: external binaries, always absolute paths (PRD §9 — GUI
// children have a minimal PATH)
export const SW_VERS_PATH = "/usr/bin/sw_vers";
export const GCLOUD_PROBE_PATHS = (homeDir: string): string[] => [
	"/opt/homebrew/bin/gcloud",
	"/usr/local/bin/gcloud",
	`${homeDir}/google-cloud-sdk/bin/gcloud`,
];
export const BREW_PROBE_PATHS = [
	"/opt/homebrew/bin/brew",
	"/usr/local/bin/brew",
];
export const GCLOUD_SDK_INSTALL_URL = "https://cloud.google.com/sdk/docs/install";
export const GCLOUD_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

// Setup engine: project provisioning (PRD §5.1 step 3)
export const PROJECT_ID_PREFIX = "slides-mcp-";
export const PROJECT_DISPLAY_NAME = "Slides MCP";
export const REQUIRED_SERVICES = [
	"slides.googleapis.com",
	"drive.googleapis.com",
	"sheets.googleapis.com",
];

// Setup engine: Google Auth Platform console pages (PRD §5.1 step 4).
// Kept here so a console URL rename is a one-line fix.
export const consoleAuthUrl = (
	page: "overview" | "branding" | "audience" | "scopes" | "clients/create",
	projectId?: string,
): string =>
	`https://console.cloud.google.com/auth/${page}` +
	(projectId ? `?project=${projectId}` : "");
