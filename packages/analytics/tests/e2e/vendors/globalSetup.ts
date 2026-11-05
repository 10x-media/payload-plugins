// biome-ignore-all lint/plugin/noProcessEnv: e2e orchestration env boundary
import { loadVendorScripts } from './scripts'
import { startUpstream } from './upstream'

/**
 * Starts the mock vendor upstream in the runner process for the run's lifetime, after the vendor
 * scripts are cached. Playwright calls the returned function once the run ends.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
	const port = Number(process.env.E2E_UPSTREAM_PORT)
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error('vendor e2e setup: E2E_UPSTREAM_PORT names no port')
	}
	const upstream = await startUpstream(port, await loadVendorScripts())
	return () => upstream.close()
}
