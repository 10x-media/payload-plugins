import { consent, expect, siteOrigin, test } from './vendors/fixtures'

/**
 * Chromium never puts these pages in the back/forward cache: every dynamic Next page answers
 * `no-store` and the tracker makes JS network requests, so Chrome reports
 * `response-cache-control-no-store-with-js-network-request` even with the no-store opt-in on. The
 * restore is the `pageshow` a cached page receives, dispatched on the live window the tracker
 * listens on.
 */
const restoreFromBackForwardCache = (): boolean =>
	window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

test('@vendors-cookieless a page restored from the back/forward cache returns held slots to pending, counting cookielessly again', async ({
	page,
	baseURL,
	native,
}) => {
	await page.goto(`${siteOrigin(baseURL)}/`)
	await consent.allow(page)
	await consent.settled(page, 'global', 'open')
	await page.getByRole('button', { name: 'Book a demo' }).click()
	await expect.poll(() => native.beacons().some((b) => (b.m ?? 'f') === 'f')).toBe(true)

	await page.evaluate(restoreFromBackForwardCache)
	await consent.settled(page, 'global', 'pending')
	const mark = native.beacons().length
	await page.getByRole('button', { name: 'Book a demo' }).click()
	await expect.poll(() => native.beacons().length).toBeGreaterThan(mark)
	const modes = new Set(
		native
			.beacons()
			.slice(mark)
			.map((b) => b.m ?? 'f')
	)
	expect([...modes], 'the restored page counts in its pending mode').toEqual(['c'])
})
