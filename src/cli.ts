#!/usr/bin/env node
/**
 * Headless CLI (PRD §5.2). M1 bootstrap for auth until the M2 setup engine
 * lands; every setup/diagnostic step stays invocable from here.
 *
 * Contract for the implementation (issue #10):
 *   auth import <client_secret.json>  validate + store client in Keychain
 *   auth login [--tier extended]      run the PKCE loopback flow
 *   auth status                       show client/account/tier state
 *   auth remove [email]               revoke with Google + delete entry
 */
const USAGE = `slides-mcp CLI

Usage:
  node dist/cli.js auth import <path-to-client_secret.json>
  node dist/cli.js auth login [--tier core|extended]
  node dist/cli.js auth status
  node dist/cli.js auth remove [email]
`;

async function main(argv: string[]): Promise<number> {
	const [group, command] = argv;
	if (group !== "auth" || !command) {
		process.stderr.write(USAGE);
		return group ? 1 : 0;
	}
	process.stderr.write(
		`"auth ${command}" is not implemented yet — tracked in issue #10\n`,
	);
	return 1;
}

main(process.argv.slice(2)).then((code) => {
	process.exitCode = code;
});
