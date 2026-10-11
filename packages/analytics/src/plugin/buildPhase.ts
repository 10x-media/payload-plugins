/**
 * True while `next build` collects page data: Payload boots once per build worker there and serves
 * nothing, so boot warnings wait for the real server.
 */
export const collectingPageData = (): boolean =>
	// biome-ignore lint/plugin/noProcessEnv: Next's own phase marker, which its build workers carry
	process.env.NEXT_PHASE === 'phase-production-build'
