import type { Page } from '@playwright/test'
import { E2E_POSTHOG_TOKENS } from '../../dev/helpers/e2eVendors'
import {
	consent,
	eventually,
	expect,
	interact,
	NOTHING_STORED,
	siteOrigin,
	storedNames,
	test,
	type UpstreamLog,
	type VendorEvent,
} from './vendors/fixtures'

/**
 * e2e.sh boots this pass with `ANALYTICS_E2E_VENDORS=pair`: a PostHog client on the global slot
 * everywhere and, on `posthog.localhost`, a second one on the tenant slot (`posthog.tenant`), each
 * with its own project token and so its own storage keys.
 */

type Client = keyof typeof E2E_POSTHOG_TOKENS

const vendorOf = (client: Client) => (client === 'global' ? 'posthog-global' : 'posthog-tenant')

/** What a client has captured from the `from`th event on. */
const eventsFrom =
	(upstream: UpstreamLog, client: Client, from = 0) =>
	async (): Promise<VendorEvent[]> =>
		(await upstream.events(vendorOf(client))).slice(from)

const countOf = async (upstream: UpstreamLog, client: Client): Promise<number> =>
	(await upstream.events(vendorOf(client))).length

/** Every storage name a client keeps, as posthog-js names them after its token. */
const keysOf = async (page: Page, client: Client): Promise<string[]> => {
	const stored = await storedNames(page)
	return [...stored.cookies, ...stored.localStorage, ...stored.sessionStorage].filter((name) =>
		name.includes(E2E_POSTHOG_TOKENS[client])
	)
}

const expectCookieless = async (upstream: UpstreamLog, client: Client, from: number) => {
	const events = await eventually(
		eventsFrom(upstream, client, from),
		(event) => event.name === 'pageview',
		`the ${client} client counted a pageview cookielessly`
	)
	expect(events.every((event) => event.cookieless)).toBe(true)
	expect((await eventsFrom(upstream, client, from)()).every((event) => event.cookieless)).toBe(true)
}

const expectFull = async (upstream: UpstreamLog, client: Client, from: number) => {
	const [first] = await eventually(
		eventsFrom(upstream, client, from),
		(event) => event.name === 'pageview' && !event.cookieless,
		`the ${client} client captured in full`
	)
	expect(first?.distinctId).toBeTruthy()
	expect(first?.distinctId).not.toBe('$posthog_cookieless')
}

test('@vendors-pair the global PostHog client counts cookielessly until consent, in full after it, and keeps only its opt-out key after revoking', async ({
	page,
	baseURL,
	upstream,
}) => {
	await page.goto(`${siteOrigin(baseURL)}/`)
	await interact(page)
	await expectCookieless(upstream, 'global', 0)
	expect(await storedNames(page)).toEqual(NOTHING_STORED)

	let mark = await countOf(upstream, 'global')
	await consent.refuse(page)
	await consent.settled(page, 'global', 'closed')
	await interact(page)
	await expectCookieless(upstream, 'global', mark)
	expect(await storedNames(page)).toEqual(NOTHING_STORED)

	mark = await countOf(upstream, 'global')
	await consent.allow(page)
	await consent.settled(page, 'global', 'open')
	await interact(page)
	await expectFull(upstream, 'global', mark)
	expect(await keysOf(page, 'global')).toContain(`ph_${E2E_POSTHOG_TOKENS.global}_posthog`)

	mark = await countOf(upstream, 'global')
	await consent.refuse(page)
	await consent.settled(page, 'global', 'closed')
	await interact(page)
	await expectCookieless(upstream, 'global', mark)
	expect(await storedNames(page)).toEqual({
		...NOTHING_STORED,
		localStorage: [`__ph_opt_in_out_${E2E_POSTHOG_TOKENS.global}`],
	})
})

test('@vendors-pair the global and tenant PostHog clients switch modes on their own gates', async ({
	page,
	baseURL,
	upstream,
}) => {
	await page.goto(`${siteOrigin(baseURL, 'posthog')}/`)
	await interact(page)
	await expectCookieless(upstream, 'global', 0)
	await expectCookieless(upstream, 'tenant', 0)
	expect(await storedNames(page)).toEqual(NOTHING_STORED)

	let global = await countOf(upstream, 'global')
	let tenant = await countOf(upstream, 'tenant')
	await consent.slot(page, 'tenant', true)
	await consent.settled(page, 'tenant', 'open')
	await consent.settled(page, 'global', 'pending')
	await interact(page)
	await expectFull(upstream, 'tenant', tenant)
	await expectCookieless(upstream, 'global', global)
	expect(await keysOf(page, 'tenant')).toContain(`ph_${E2E_POSTHOG_TOKENS.tenant}_posthog`)
	expect(await keysOf(page, 'global'), 'the global client stores nothing').toEqual([])

	global = await countOf(upstream, 'global')
	tenant = await countOf(upstream, 'tenant')
	await consent.slot(page, 'tenant', false)
	await consent.settled(page, 'tenant', 'closed')
	await interact(page)
	await expectCookieless(upstream, 'tenant', tenant)
	await expectCookieless(upstream, 'global', global)
	expect(await storedNames(page)).toEqual({
		...NOTHING_STORED,
		localStorage: [`__ph_opt_in_out_${E2E_POSTHOG_TOKENS.tenant}`],
	})

	global = await countOf(upstream, 'global')
	tenant = await countOf(upstream, 'tenant')
	await consent.slot(page, 'global', true)
	await consent.settled(page, 'global', 'open')
	await consent.settled(page, 'tenant', 'closed')
	await interact(page)
	await expectFull(upstream, 'global', global)
	await expectCookieless(upstream, 'tenant', tenant)
	expect(await keysOf(page, 'global')).toContain(`ph_${E2E_POSTHOG_TOKENS.global}_posthog`)
	expect(
		await keysOf(page, 'tenant'),
		'the refused tenant client keeps its opt-out key only'
	).toEqual([`__ph_opt_in_out_${E2E_POSTHOG_TOKENS.tenant}`])
})
