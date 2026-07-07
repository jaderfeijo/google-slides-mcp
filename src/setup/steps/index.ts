import type { SetupStep } from "../types.js";

/**
 * The five steps of PRD §5.1, in order. Populated as the milestone lands:
 * preflight / provisioning_signin / project_provisioning (#23),
 * console_client (#24/#25), first_account_auth (#26).
 */
export const SETUP_STEPS: ReadonlyArray<SetupStep> = [];
