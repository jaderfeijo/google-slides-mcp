import type { SetupStep } from "../types.js";
import { preflight } from "./preflight.js";
import { provisioningSignin } from "./provisioning-signin.js";
import { projectProvisioning } from "./project-provisioning.js";
import { consoleClient } from "./console-client.js";
import { firstAccountAuth } from "./first-account-auth.js";

/** The five steps of PRD §5.1, in order. */
export const SETUP_STEPS: ReadonlyArray<SetupStep> = [
	preflight,
	provisioningSignin,
	projectProvisioning,
	consoleClient,
	firstAccountAuth,
];
