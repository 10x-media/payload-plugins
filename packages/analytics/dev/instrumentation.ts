// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary

/**
 * Boots Payload (and with it `onInit`'s seed) at server start, before Next has loaded an
 * app-page module.
 *
 * Next's dev app-page runtime installs a process-wide `async_hooks` init hook that
 * constructs and stack-parses an `Error` for every promise the process creates, and keeps a
 * node per promise. Seeding from `onInit` means the seed's ~3.3k document writes ride that
 * hook: in tenancy mode (roughly five times single-tenant's volume) the boot spends minutes
 * pinned at 100% CPU with a multi-gigabyte heap and the server answers nothing meanwhile.
 * `register` runs before that hook exists, so the same seed pays no tax. The request-time
 * `getPayload` then finds the instance already booted, and `seedDev` is idempotent either
 * way.
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
