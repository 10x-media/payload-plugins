import type { Page } from '@playwright/test'
import type { E2eVendorSite } from '../../dev/helpers/e2eVendors'
import { consent, expect, interact, siteOrigin, test } from './vendors/fixtures'

/**
 * e2e.sh boots this pass with `ANALYTICS_E2E_VENDORS=strict`: `capture.withoutConsent: 'off'`, the
 * behaviour of 1.0.0-beta.14. Native holds the global slot on every site, the vendor the tenant one.
 */

/**
 * Longer than posthog-js's batch interval (3 s), the slowest of the senders to flush, so a request
 * that was going to be sent has been by the time the spec checks there was none.
 */
const SETTLE_MS = 3_500

const settle = async (page: Page): Promise<void> => {
	await page.waitForLoadState('networkidle')
	await page.waitForTimeout(SETTLE_MS)
}

interface Traffic {
	ingestOrProxy: string[]
	upstream: string[]
	google: string[]
}

const NO_TRAFFIC: Traffic = { ingestOrProxy: [], upstream: [], google: [] }

/** What `now` holds beyond `before`, source by source. */
const since = (now: Traffic, before: Traffic): Traffic => ({
	ingestOrProxy: now.ingestOrProxy.slice(before.ingestOrProxy.length),
	upstream: now.upstream.slice(before.upstream.length),
	google: now.google.slice(before.google.length),
})

/** What carries a count: every request but a script load. */
const sendsIn = (traffic: Traffic): string[] =>
	[...traffic.ingestOrProxy, ...traffic.upstream, ...traffic.google].filter(
		(entry) => !/\.js(\?| |$)|\/gtag\/js/.test(entry)
	)

/** How long gtag may hold a hit before sending it. */
const GTAG_HOLD = { timeout: 15_000 }

/** The tab going to the background and back, which is when vendors flush engagement. */
const hideAndShow = async (page: Page): Promise<void> => {
	for (const state of ['hidden', 'visible']) {
		await page.evaluate((visibility) => {
			Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true })
			Object.defineProperty(document, 'hidden', {
				value: visibility === 'hidden',
				configurable: true,
			})
			document.dispatchEvent(new Event('visibilitychange'))
		}, state)
	}
}

const SITES: Array<{ label: string; site?: E2eVendorSite }> = [
	{ label: 'native' },
	{ label: 'plausible', site: 'plausible' },
	{ label: 'umami', site: 'umami' },
	{ label: 'posthog', site: 'posthog' },
	{ label: 'ga4', site: 'ga4' },
]

for (const { label, site } of SITES) {
	test.describe(`@vendors-strict ${label}`, () => {
		test('sends nothing to native ingest or any vendor before consent, and nothing after a refusal', async ({
			page,
			baseURL,
			upstream,
			external,
			captured,
		}) => {
			/** Every request bound for ingest or a vendor, scripts included, by where it went. */
			const traffic = async (): Promise<Traffic> => ({
				ingestOrProxy: captured.map(
					(request) => `${request.method()} ${new URL(request.url()).pathname}`
				),
				upstream: (await upstream.requests()).map(
					(request) =>
						`${request.method} ${request.vendor}${request.path} ${JSON.stringify(request.body)?.slice(0, 160)}`
				),
				google: external.google(),
			})

			await page.goto(`${siteOrigin(baseURL, site)}/`)
			await interact(page)
			await settle(page)
			expect(await traffic(), 'nothing before an answer').toEqual(NO_TRAFFIC)

			await consent.allow(page)
			await consent.settled(page, 'global', 'open')
			await interact(page)
			await expect
				.poll(async () => sendsIn(await traffic()).length, { message: 'consent starts capture' })
				.toBeGreaterThan(0)
			if (site === 'ga4') {
				// Allowed: gtag holds an event about 5 s, so the consented goal is awaited before refusing.
				await expect
					.poll(() => external.google().some((entry) => entry.includes('book_demo')), GTAG_HOLD)
					.toBe(true)
			}

			// Everything the consented interaction sent has landed, so the refusal's window is its own.
			await settle(page)
			const consented = await traffic()
			await consent.refuse(page)
			await consent.settled(page, 'global', 'closed')
			await settle(page)
			const atRefusal = since(await traffic(), consented)
			// Allowed: Plausible sends one `engagement` at the refusal, for the page viewed while consented.
			const engagement = site === 'plausible' ? 1 : 0
			expect(atRefusal.google, 'nothing to Google at the refusal').toEqual([])
			expect(sendsIn({ ...atRefusal, upstream: [] }), 'one request per allowed send').toHaveLength(
				engagement
			)
			expect(sendsIn({ ...NO_TRAFFIC, upstream: atRefusal.upstream })).toEqual(
				Array.from({ length: engagement }, () => expect.stringContaining('"n":"engagement"'))
			)

			const refused = await traffic()
			await hideAndShow(page)
			await interact(page)
			await settle(page)
			expect(sendsIn(since(await traffic(), refused)), 'nothing after a refusal').toEqual([])
		})

		test('a refusal before any answer sends nothing at all', async ({
			page,
			baseURL,
			upstream,
			external,
			captured,
		}) => {
			await page.goto(`${siteOrigin(baseURL, site)}/`)
			await consent.refuse(page)
			await consent.settled(page, 'global', 'closed')
			await interact(page)
			await settle(page)
			expect(captured.map((request) => request.url())).toEqual([])
			expect(await upstream.requests()).toEqual([])
			expect(external.google()).toEqual([])
		})
	})
}
