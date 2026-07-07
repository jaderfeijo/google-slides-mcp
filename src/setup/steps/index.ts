import type { SetupStep } from "../types.js";
import { preflight } from "./preflight.js";
import { provisioningSignin } from "./provisioning-signin.js";
import { projectProvisioning } from "./project-provisioning.js";

/**
 * The five steps of PRD §5.1, in order. Remaining entries land with
 * console_client (#24/#25) and first_account_auth (#26).
 */
export const SETUP_STEPS: ReadonlyArray<SetupStep> = [
	preflight,
	provisioningSignin,
	projectProvisioning,
];
