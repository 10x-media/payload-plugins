// biome-ignore-all lint/plugin/noProcessEnv: e2e orchestration env boundary
import { test as base, expect, type Page, type Request } from '@playwright/test'
import { E2E_GA4_MEASUREMENT_ID, type E2eVendorSite } from '../../../dev/helpers/e2eVendors'
import { localOrigin } from '../helpers'
import { cachedGtag } from './scripts'
import { UPSTREAM_LOG_PATH, type UpstreamRequest, type UpstreamVendor } from './upstream'

const upstreamUrl = (): string => `http://127.0.0.1:${process.env.E2E_UPSTREAM_PORT ?? ''}`

/** One event a vendor received, in the few fields the specs compare across vendors. */
export interface VendorEvent {
	/** `pageview` for every vendor's own pageview event, else the event's name. */
	name: string
	/** PostHog's distinct id; `$posthog_cookieless` while a client counts cookielessly. */
	distinctId?: string
	/** PostHog's `$cookieless_mode` property. */
	cookieless?: boolean
	/** GA4's consent state for the hit (`gcs`), such as `G100` (denied) or `G101` (analytics granted). */
	consent?: string
	url?: string
	token?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** posthog-js posts one event, an array of them, or `{ batch }`. */
const posthogEventsOf = (body: unknown): VendorEvent[] => {
	const list = Array.isArray(body)
		? body
		: isRecord(body) && Array.isArray(body.batch)
			? body.batch
			: [body]
	return list.filter(isRecord).map((event) => {
		const props = isRecord(event.properties) ? event.properties : {}
		const name = text(event.event) ?? ''
		return {
			name: name === '$pageview' ? 'pageview' : name,
			distinctId: text(props.distinct_id) ?? text(event.distinct_id),
			cookieless: props.$cookieless_mode === true,
			url: text(props.$current_url),
			token: text(props.token) ?? text(event.api_key),
		}
	})
}

const eventsOf = (request: UpstreamRequest): VendorEvent[] => {
	if (request.method !== 'POST' || !request.body) {
		return []
	}
	const body = request.body
	if (request.vendor === 'plausible' && isRecord(body)) {
		return [{ name: text(body.n) ?? '', url: text(body.u) }]
	}
	if (request.vendor === 'umami' && isRecord(body) && isRecord(body.payload)) {
		const payload = body.payload
		return [{ name: text(payload.name) ?? 'pageview', url: text(payload.url) }]
	}
	if (/^\/(e|i\/v0\/e|batch|capture)\/?$/.test(request.path)) {
		return posthogEventsOf(body)
	}
	return []
}

/** The mock upstream's request log, as the browser reached it through the capture proxy. */
export interface UpstreamLog {
	requests(vendor?: UpstreamVendor): Promise<UpstreamRequest[]>
	events(vendor: UpstreamVendor): Promise<VendorEvent[]>
	clear(): Promise<void>
}

const upstreamLog: UpstreamLog = {
	async requests(vendor) {
		const res = await fetch(`${upstreamUrl()}${UPSTREAM_LOG_PATH}`)
		const all = (await res.json()) as UpstreamRequest[]
		return vendor ? all.filter((request) => request.vendor === vendor) : all
	},
	async events(vendor) {
		return (await this.requests(vendor)).flatMap(eventsOf)
	},
	async clear() {
		await fetch(`${upstreamUrl()}${UPSTREAM_LOG_PATH}`, { method: 'DELETE' })
	},
}

const GOOGLE_COLLECT =
	/^https:\/\/([\w-]+\.)?(google-analytics|analytics\.google)\.com\/([\w/]*\/)?collect/
const GTAG_SCRIPT = /^https:\/\/www\.googletagmanager\.com\/gtag\/js/
/** gtag's own tag diagnostics, sent now and then with the page's address: Google traffic too. */
const GTAG_DIAGNOSTICS = /^https:\/\/www\.googletagmanager\.com\/td\b/

/** GA4 hits: one per event, the request's own parameters under each line of its body. */
const ga4EventsOf = (request: Request): VendorEvent[] => {
	const url = new URL(request.url())
	const lines = (request.postData() ?? '').split('\n').filter((line) => line.trim() !== '')
	return (lines.length > 0 ? lines : ['']).map((line) => {
		const params = new URLSearchParams(url.search)
		for (const [key, value] of new URLSearchParams(line)) {
			params.set(key, value)
		}
		const name = params.get('en') ?? ''
		return {
			name: name === 'page_view' ? 'pageview' : name,
			consent: params.get('gcs') ?? undefined,
			url: params.get('dl') ?? undefined,
			token: params.get('tid') ?? undefined,
		}
	})
}

/** Everything the page asked of a host that is not the dev app's or the mock upstream's. */
export interface ExternalLog {
	ga4(): VendorEvent[]
	/** Requests to Google: the tag script's URL, or `collect` and each hit's event and `gcs`. */
	google(): string[]
	/** Any other external request, which was refused. */
	unexpected(): string[]
}

// posthog-js drops all events from a browser with `navigator.webdriver` or a HeadlessChrome brand.
const LOOK_LIKE_A_VISITOR = [
	"Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })",
	"Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined })",
].join(';')

const isLocal = (url: URL): boolean =>
	url.hostname === 'localhost' ||
	url.hostname.endsWith('.localhost') ||
	url.hostname === '127.0.0.1'

/** A native beacon, as the page sent it to ingest. */
export interface NativeBeacon {
	type?: string
	/** The mode the tracker states: `c`ookieless, `a`nonymous or `f`ull. Absent reads as full. */
	m?: string
	path?: string
	name?: string
}

export interface NativeLog {
	beacons(): NativeBeacon[]
}

const isIngest = (request: Request): boolean =>
	request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/_x/e')

/** Whether a request went to the plugin's capture proxy, which forwards to a vendor. */
export const isProxied = (request: Request): boolean =>
	new URL(request.url()).pathname.includes('/_x/p/')

export const test = base.extend<{
	upstream: UpstreamLog
	external: ExternalLog
	native: NativeLog
	/** Every request the page made to ingest or the capture proxy, in order. */
	captured: Request[]
}>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern
	upstream: async ({}, use) => {
		await upstreamLog.clear()
		await use(upstreamLog)
	},
	external: [
		async ({ context }, use) => {
			const ga4: VendorEvent[] = []
			const google: string[] = []
			const unexpected: string[] = []
			const gtag = await cachedGtag()
			await context.addInitScript({ content: LOOK_LIKE_A_VISITOR })
			// Nothing leaves the machine: GA4's tag is served from the cache and its hits are recorded.
			await context.route(
				(url) => !isLocal(url),
				async (route) => {
					const request = route.request()
					const url = request.url()
					if (GTAG_SCRIPT.test(url)) {
						google.push(url)
						await route.fulfill({ body: gtag, contentType: 'text/javascript' })
						return
					}
					if (GOOGLE_COLLECT.test(url)) {
						const hits = ga4EventsOf(request)
						google.push(`collect ${hits.map((hit) => `${hit.name}:${hit.consent}`).join(',')}`)
						ga4.push(...hits)
						await route.fulfill({ status: 204 })
						return
					}
					if (GTAG_DIAGNOSTICS.test(url)) {
						google.push(`diagnostics ${url}`)
						await route.fulfill({ status: 204 })
						return
					}
					unexpected.push(url)
					await route.abort()
				}
			)
			await use({
				ga4: () => [...ga4],
				google: () => [...google],
				unexpected: () => [...unexpected],
			})
		},
		{ auto: true },
	],
	native: async ({ page }, use) => {
		// A beacon's Blob body is readable only while requests are routed, which `external` does.
		const beacons: NativeBeacon[] = []
		page.on('request', (request) => {
			if (isIngest(request)) {
				beacons.push(request.postDataJSON() as NativeBeacon)
			}
		})
		await use({ beacons: () => [...beacons] })
	},
	captured: async ({ page }, use) => {
		const requests: Request[] = []
		page.on('request', (request) => {
			if (isIngest(request) || isProxied(request)) {
				requests.push(request)
			}
		})
		await use(requests)
	},
})

export { expect }

/** The dev site on plain `localhost`, or on the vendor site that puts `site` in the tenant slot. */
export const siteOrigin = (baseURL: string | undefined, site?: E2eVendorSite): string =>
	localOrigin(baseURL, site)

/** Every name the page's origin holds in each kind of browser storage. */
export interface StoredNames {
	cookies: string[]
	localStorage: string[]
	sessionStorage: string[]
}

export const NOTHING_STORED: StoredNames = { cookies: [], localStorage: [], sessionStorage: [] }

/** What the browser holds: the context's cookies for every host, and the page origin's storage. */
export const storedNames = async (page: Page): Promise<StoredNames> => {
	const cookies = (await page.context().cookies()).map((cookie) => cookie.name).sort()
	const [local, session] = await page.evaluate(() => [
		Object.keys(window.localStorage).sort(),
		Object.keys(window.sessionStorage).sort(),
	])
	return { cookies, localStorage: local ?? [], sessionStorage: session ?? [] }
}

/** The consent manager stand-in's answers (dev/components/ConsentToggle). */
export const consent = {
	allow: (page: Page) => page.getByRole('button', { name: 'Allow analytics' }).click(),
	refuse: (page: Page) => page.getByRole('button', { name: 'Refuse analytics' }).click(),
	slot: (page: Page, slot: 'global' | 'tenant', allow: boolean) =>
		page.getByRole('button', { name: `${allow ? 'Allow' : 'Refuse'} ${slot} slot` }).click(),
	/** Settles once the stand-in shows the slot's gate as `status`. */
	settled: (page: Page, slot: 'global' | 'tenant', status: 'pending' | 'open' | 'closed') =>
		expect(page.getByRole('complementary', { name: 'Demo consent manager' })).toHaveAttribute(
			`data-gate-${slot}`,
			status
		),
}

/**
 * What a visitor does: from any page, a client-side navigation (`pushState`) to the home page, a
 * goal click there, and another to About. Ends on About, with the consent stand-in in view.
 */
export const interact = async (page: Page): Promise<void> => {
	if (new URL(page.url()).pathname !== '/') {
		await page.getByRole('link', { name: /All pages/ }).click()
		await page.waitForURL((url) => url.pathname === '/')
	}
	await page.getByRole('button', { name: 'Book a demo' }).click()
	await page.getByRole('link', { name: 'About', exact: true }).click()
	await page.waitForURL((url) => url.pathname === '/about')
	await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
}

/** Waits until `read` reports at least one event matching `match`, then returns them all. */
export const eventually = async (
	read: () => Promise<VendorEvent[]> | VendorEvent[],
	match: (event: VendorEvent) => boolean,
	message: string
): Promise<VendorEvent[]> => {
	let found: VendorEvent[] = []
	await expect
		.poll(
			async () => {
				found = (await read()).filter(match)
				return found.length
			},
			{ message, timeout: 15_000 }
		)
		.toBeGreaterThan(0)
	return found
}

export const GA4_ID = E2E_GA4_MEASUREMENT_ID
