// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary

/**
 * Boots Payload (and with it `onInit`'s seed) at server start, before Next has loaded an
 * app-page module. Next's dev app-page runtime installs an `async_hooks` init hook that builds
 * an `Error` for every promise, and the seed's tens of thousands of promises under it pin the
 * CPU for minutes; `register` runs before that hook exists. Request-time `getPayload` then finds
 * the instance booted.
 */
export const register = async (): Promise<void> => {
	// `next build` collects page data through this hook too, and `memoryDb` hands that phase a
	// placeholder URI it must never connect to.
	if (
		process.env.NEXT_RUNTIME !== 'nodejs' ||
		process.env.NEXT_PHASE === 'phase-production-build'
	) {
		return
	}
	const [{ getPayload }, { default: config }] = await Promise.all([
		import('payload'),
		import('./payload.config'),
	])
	await getPayload({ config })
}
