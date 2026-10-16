import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { E2E_GA4_MEASUREMENT_ID } from '../../../dev/helpers/e2eVendors'

/** Each vendor's real browser script, as its CDN serves it. PostHog's load per file: {@link posthogStatic}. */
export interface VendorScripts {
	plausible: Buffer
	umami: Buffer
	gtag: Buffer
}

/**
 * Plausible's `script.local.js` is its `script.js` with the localhost check left out, which the
 * dev sites need, and the `navigator.webdriver` check, which would drop every Playwright pageview.
 */
const SOURCES: Readonly<Record<keyof VendorScripts, string>> = {
	plausible: 'https://plausible.io/js/script.local.js',
	umami: 'https://cloud.umami.is/script.js',
	gtag: `https://www.googletagmanager.com/gtag/js?id=${E2E_GA4_MEASUREMENT_ID}`,
}

/** Survives runs on one machine, so only the first run on it needs the network. */
export const VENDOR_SCRIPT_DIR = path.join(tmpdir(), 'analytics-e2e-vendor-scripts')

const cached = (name: keyof VendorScripts): string => path.join(VENDOR_SCRIPT_DIR, `${name}.js`)

const fetchScript = async (name: keyof VendorScripts): Promise<Buffer> => {
	const url = SOURCES[name]
	let res: Response
	try {
		res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
	} catch (err) {
		throw new Error(
			`vendor e2e setup: could not download ${name}'s browser script from ${url} (${String(err)}). The vendor specs serve each vendor's real script and cache it in ${VENDOR_SCRIPT_DIR}: connect once, or copy the files there.`
		)
	}
	if (!res.ok) {
		throw new Error(`vendor e2e setup: ${url} answered ${res.status}`)
	}
	const body = Buffer.from(await res.arrayBuffer())
	await writeFile(cached(name), body)
	return body
}

/** The cached scripts, each downloaded once when missing. */
export const loadVendorScripts = async (): Promise<VendorScripts> => {
	await mkdir(VENDOR_SCRIPT_DIR, { recursive: true })
	const load = async (name: keyof VendorScripts): Promise<Buffer> =>
		(await readFile(cached(name)).catch(() => null)) ?? (await fetchScript(name))
	const [plausible, umami, gtag] = await Promise.all([
		load('plausible'),
		load('umami'),
		load('gtag'),
	])
	return { plausible, umami, gtag }
}

/** gtag.js from the cache, which {@link loadVendorScripts} filled before any test ran. */
export const cachedGtag = (): Promise<Buffer> => readFile(cached('gtag'))

/** Where the plugin's proxy fetches PostHog's scripts in production: its current, unpinned build. */
const POSTHOG_STATIC = 'https://us-assets.i.posthog.com/static/'

/**
 * One of PostHog's static files (`array.js` and the extensions it loads), downloaded once and cached
 * like the other vendor scripts; null when PostHog has no such file.
 */
export const posthogStatic = async (file: string): Promise<Buffer | null> => {
	const local = path.join(VENDOR_SCRIPT_DIR, 'posthog', file)
	const kept = await readFile(local).catch(() => null)
	if (kept) {
		return kept
	}
	let res: Response
	try {
		res = await fetch(`${POSTHOG_STATIC}${file}`, { signal: AbortSignal.timeout(15_000) })
	} catch (err) {
		throw new Error(
			`vendor e2e setup: could not download PostHog's ${file} (${String(err)}). Connect once, or copy it to ${local}.`
		)
	}
	if (res.status === 404) {
		return null
	}
	if (!res.ok) {
		throw new Error(`vendor e2e setup: ${POSTHOG_STATIC}${file} answered ${res.status}`)
	}
	const body = Buffer.from(await res.arrayBuffer())
	await mkdir(path.dirname(local), { recursive: true })
	await writeFile(local, body)
	return body
}
