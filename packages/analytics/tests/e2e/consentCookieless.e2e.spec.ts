import type { Page } from '@playwright/test'
import { E2E_POSTHOG_TOKENS } from '../../dev/helpers/e2eVendors'
import { login } from './helpers'
import {
	consent,
	eventually,
	expect,
	GA4_ID,
	interact,
	type NativeBeacon,
	NOTHING_STORED,
	siteOrigin,
	storedNames,
	test,
	type VendorEvent,
} from './vendors/fixtures'

/**
 * e2e.sh boots this pass with `ANALYTICS_E2E_VENDORS=cookieless`: `capture.gate: 'all'` and no
 * `capture.withoutConsent`, so every held slot counts cookielessly until the visitor answers. Native
 * fills the global slot everywhere; `<vendor>.localhost` adds that vendor on the tenant slot.
 */

const TENANT_TOKEN = E2E_POSTHOG_TOKENS.tenant

/** Beacons sent from `from` on, so a phase's assertions see only what that phase sent. */
const since = (beacons: NativeBeacon[], from: number): NativeBeacon[] => beacons.slice(from)

const modesOf = (beacons: NativeBeacon[]): string[] => [
	...new Set(beacons.map((beacon) => beacon.m ?? 'f')),
]

const expectNothingStored = async (page: Page, when: string): Promise<void> => {
	expect(await storedNames(page), `nothing stored ${when}`).toEqual(NOTHING_STORED)
}

test.describe('@vendors-cookieless native', () => {
	test('counts cookielessly before an answer and after a refusal, and in full once allowed, storing nothing', async ({
		page,
		baseURL,
		native,
	}) => {
		await page.goto(`${siteOrigin(baseURL)}/`)
		await expect.poll(() => native.beacons().some((b) => b.type === 'pageview')).toBe(true)
		await expectNothingStored(page, 'after load')
		await interact(page)
		await expect.poll(() => native.beacons().filter((b) => b.type === 'pageview').length).toBe(2)
		expect(modesOf(native.beacons()), 'pending counts cookielessly').toEqual(['c'])
		await expectNothingStored(page, 'after interacting, unanswered')

		let mark = native.beacons().length
		await consent.refuse(page)
		await consent.settled(page, 'global', 'closed')
		await interact(page)
		await expect.poll(() => since(native.beacons(), mark).length).toBeGreaterThanOrEqual(2)
		expect(modesOf(since(native.beacons(), mark)), 'a refusal counts cookielessly').toEqual(['c'])
		await expectNothingStored(page, 'after a refusal')

		mark = native.beacons().length
		await consent.allow(page)
		await consent.settled(page, 'global', 'open')
		await interact(page)
		await expect.poll(() => since(native.beacons(), mark).length).toBeGreaterThanOrEqual(2)
		expect(modesOf(since(native.beacons(), mark)), 'consent counts in full').toEqual(['f'])
		// Native's full mode keeps no identifier on the device either.
		await expectNothingStored(page, 'after consent')

		mark = native.beacons().length
		await consent.refuse(page)
		await consent.settled(page, 'global', 'closed')
		await interact(page)
		await expect.poll(() => since(native.beacons(), mark).length).toBeGreaterThanOrEqual(2)
		expect(modesOf(since(native.beacons(), mark)), 'revoking returns to cookieless').toEqual(['c'])
		await expectNothingStored(page, 'after revoking')
	})
})

interface InherentVendor {
	site: 'plausible' | 'umami'
	/** The goal the home page's button completes, as the vendor names the event. */
	goal: string
}

const INHERENT: InherentVendor[] = [
	{ site: 'plausible', goal: 'book-demo' },
	{ site: 'umami', goal: 'book-demo' },
]

for (const { site, goal } of INHERENT) {
	test.describe(`@vendors-cookieless ${site}`, () => {
		test('loads its own script and counts pageviews in every phase, never storing anything', async ({
			page,
			baseURL,
			upstream,
		}) => {
			const events = () => upstream.events(site)
			const count = async (match: (event: VendorEvent) => boolean) =>
				(await events()).filter(match).length

			await page.goto(`${siteOrigin(baseURL, site)}/`)
			await eventually(events, (e) => e.name === 'pageview', `${site} counted the first pageview`)
			await expectNothingStored(page, 'after load')

			await interact(page)
			await eventually(events, (e) => e.name === goal, `${site} received the goal`)
			await expect
				.poll(() => count((e) => e.name === 'pageview'), {
					message: 'the load and the pushState to About',
				})
				.toBeGreaterThanOrEqual(2)
			await expectNothingStored(page, 'after interacting, unanswered')

			for (const [answer, status] of [
				[consent.refuse, 'closed'],
				[consent.allow, 'open'],
				[consent.refuse, 'closed'],
			] as const) {
				const before = await count((e) => e.name === 'pageview')
				await answer(page)
				await consent.settled(page, 'tenant', status)
				await interact(page)
				// The same requests in every phase: the script itself never changes mode.
				await expect
					.poll(() => count((e) => e.name === 'pageview'), {
						message: `${site} keeps counting once ${status}`,
					})
					.toBeGreaterThanOrEqual(before + 2)
				await expectNothingStored(page, `once the gate is ${status}`)
			}
		})
	})
}

test.describe('@vendors-cookieless posthog', () => {
	test('counts cookielessly from the first pageview, goes full on consent without a reload, and keeps only its opt-out key after revoking', async ({
		page,
		baseURL,
		upstream,
	}) => {
		const read = () => upstream.events('posthog-tenant')
		await page.goto(`${siteOrigin(baseURL, 'posthog')}/`)
		const first = await eventually(
			read,
			(e) => e.name === 'pageview',
			'PostHog counted the first pageview while pending'
		)
		expect(first.every((e) => e.cookieless && e.distinctId === '$posthog_cookieless')).toBe(true)
		await expectNothingStored(page, 'after load')

		await interact(page)
		await eventually(read, (e) => e.name === 'book-demo', 'PostHog received the goal')
		expect((await read()).every((e) => e.cookieless)).toBe(true)
		await expectNothingStored(page, 'after interacting, unanswered')

		await consent.refuse(page)
		await consent.settled(page, 'tenant', 'closed')
		const refusedFrom = (await read()).length
		await interact(page)
		await expect.poll(async () => (await read()).length).toBeGreaterThan(refusedFrom)
		expect((await read()).slice(refusedFrom).every((e) => e.cookieless)).toBe(true)
		// A refusal before any grant writes nothing, not even PostHog's consent key.
		await expectNothingStored(page, 'after a refusal')

		await consent.allow(page)
		await consent.settled(page, 'tenant', 'open')
		const grantedFrom = (await read()).length
		await interact(page)
		const full = await eventually(
			async () => (await read()).slice(grantedFrom),
			(e) => e.name === 'pageview' && !e.cookieless,
			'PostHog captures in full on the same page'
		)
		const distinctId = full[0]?.distinctId
		expect(distinctId).toBeTruthy()
		expect(distinctId).not.toBe('$posthog_cookieless')
		const stored = await storedNames(page)
		// posthog-js persists to `localStorage+cookie` by default: the id in both.
		expect([...stored.cookies, ...stored.localStorage]).toContain(`ph_${TENANT_TOKEN}_posthog`)

		await consent.refuse(page)
		await consent.settled(page, 'tenant', 'closed')
		const revokedFrom = (await read()).length
		await interact(page)
		await eventually(
			async () => (await read()).slice(revokedFrom),
			(e) => e.name === 'pageview' && e.cookieless === true,
			'PostHog returns to cookieless after revoking'
		)
		expect((await read()).slice(revokedFrom).every((e) => e.cookieless)).toBe(true)
		expect(await storedNames(page), 'only the opt-out key remains').toEqual({
			...NOTHING_STORED,
			localStorage: [`__ph_opt_in_out_${TENANT_TOKEN}`],
		})
	})
})

test.describe('@vendors-cookieless ga4', () => {
	/** `gcs` is `G1` and one digit each for ad and analytics storage: `1` granted, `0` denied. */
	const analyticsGranted = (event: VendorEvent): boolean => event.consent?.charAt(3) === '1'
	/** gtag holds an event for a few seconds and sends it with the next, so a hit lands late. */
	const GA4_BATCH = { timeout: 15_000 }

	test('opted in, loads with every signal denied and pings cookielessly, then grants analytics storage on consent', async ({
		page,
		baseURL,
		external,
	}) => {
		const hits = () => external.ga4().filter((hit) => hit.token === GA4_ID)
		const goals = () => hits().filter((hit) => hit.name === 'book_demo')
		/**
		 * Every goal click of the phases so far has been sent, so the next phase's hits are its own.
		 * The goal, not a pushState page_view: gtag for an unknown measurement id sends none on pushState.
		 */
		const flushed = async (clicks: number) => {
			await expect.poll(() => goals().length, GA4_BATCH).toBe(clicks)
			return goals().slice(clicks - 1)
		}

		await page.goto(`${siteOrigin(baseURL, 'ga4')}/`)
		const first = await eventually(
			hits,
			(e) => e.name === 'pageview',
			'GA4 pinged the first pageview while pending'
		)
		expect(first.every((e) => e.consent === 'G100')).toBe(true)
		await expectNothingStored(page, 'after load')

		await interact(page)
		expect((await flushed(1)).every((e) => e.consent === 'G100')).toBe(true)
		await expectNothingStored(page, 'after interacting, unanswered')

		await consent.refuse(page)
		await consent.settled(page, 'tenant', 'closed')
		await interact(page)
		expect((await flushed(2)).every((e) => e.consent === 'G100')).toBe(true)
		await expectNothingStored(page, 'after a refusal')

		await consent.allow(page)
		await consent.settled(page, 'tenant', 'open')
		await interact(page)
		// Ad signals stay denied unless the host maps them.
		expect((await flushed(3)).map((e) => e.consent)).toEqual(['G101'])
		expect((await storedNames(page)).cookies).toContain('_ga')

		await consent.refuse(page)
		await consent.settled(page, 'tenant', 'closed')
		await interact(page)
		expect((await flushed(4)).every((e) => !analyticsGranted(e))).toBe(true)
		expect(await storedNames(page), 'revoking expires the _ga cookies').toEqual(NOTHING_STORED)
		expect(external.unexpected()).toEqual([])
	})
})

test.describe('@vendors-cookieless exclusion', () => {
	test('the exclusion flag is not read while a slot counts cookielessly, and is honoured once it is full', async ({
		page,
		request,
		baseURL,
		native,
	}) => {
		// Signed in on a context of its own, so the visitor's browser holds no session cookie.
		await login(request)
		const link = await request.get('/api/_x/exclusion')
		expect(link.ok(), 'exclusion link').toBeTruthy()
		const { param, token } = (await link.json()) as { param: string; token: string }
		const origin = siteOrigin(baseURL)

		await page.goto(`${origin}/?${param}=${token}`)
		await expect(page).not.toHaveURL(new RegExp(param))
		await page.goto(`${origin}/`)
		await expect.poll(() => native.beacons().some((b) => b.type === 'pageview')).toBe(true)
		const mark = native.beacons().length
		await interact(page)
		await expect
			.poll(() => since(native.beacons(), mark).length, {
				message: 'an excluded browser still counts cookielessly: the flag is not read',
			})
			.toBeGreaterThanOrEqual(2)
		expect(modesOf(native.beacons())).toEqual(['c'])

		await consent.allow(page)
		await consent.settled(page, 'global', 'open')
		const granted = native.beacons().length
		await interact(page)
		// The navigation is the barrier: anything the interaction sent was posted before it.
		await page.goto(`${origin}/thank-you`)
		expect(since(native.beacons(), granted), 'nothing once full reads the flag').toEqual([])

		await page.goto(`${origin}/?${param}=0`)
		await expect(page).not.toHaveURL(new RegExp(param))
	})
})
