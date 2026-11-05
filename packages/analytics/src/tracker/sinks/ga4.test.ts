import { describe, expect, it, vi } from 'vitest'
import { ga4DisableKey } from '../../adapters/ga4/disableKey'
import type { TrackerWindow, VendorSwitch } from '../types'
import { createGa4Sink, gaCookieNames } from './ga4'

const ID = 'G-AB12CD34'

/** A window whose tag ran: gtag, its config in the dataLayer, and every cookie write recorded. */
const tagWindow = (hostname = 'www.shop.example.com') => {
	const cookies: string[] = []
	const gtag = vi.fn()
	const win = {
		location: { hostname },
		document: {
			set cookie(value: string) {
				cookies.push(value)
			},
		},
		dataLayer: [['config', ID]],
		gtag,
		setTimeout,
	}
	return { win: win as unknown as TrackerWindow, gtag, cookies }
}

const sinkOn = (win: TrackerWindow, cookieless: boolean) =>
	createGa4Sink({
		slot: 'global',
		win,
		scripts: [],
		loadScript: () => Promise.resolve(),
		measurementId: ID,
		cookieless,
	})

const to = (mode: VendorSwitch['mode'], refused = false): VendorSwitch => ({ mode, refused })

const consentUpdates = (gtag: ReturnType<typeof vi.fn>) =>
	gtag.mock.calls.filter(([command]) => command === 'consent').map((call) => call[2])

describe('a GA4 slot counting without consent', () => {
	it('grants analytics storage alone on consent, and denies it again on a revoke', () => {
		const { win, gtag } = tagWindow()
		const sink = sinkOn(win, true)
		sink.mode?.(to('cookieless'))
		sink.mode?.(to('full'))
		sink.mode?.(to('full'))
		sink.mode?.(to('cookieless', true))
		expect(consentUpdates(gtag)).toEqual([
			{ analytics_storage: 'granted' },
			{ analytics_storage: 'denied' },
		])
		expect(Reflect.get(win, ga4DisableKey(ID))).toBe(false)
	})

	it('stops the tag outright when off, every signal denied', () => {
		const { win, gtag } = tagWindow()
		sinkOn(win, true).mode?.(to('off', true))
		expect(Reflect.get(win, ga4DisableKey(ID))).toBe(true)
		expect(consentUpdates(gtag)).toEqual([
			{
				analytics_storage: 'denied',
				ad_storage: 'denied',
				ad_user_data: 'denied',
				ad_personalization: 'denied',
			},
		])
	})

	it('switches no cookie itself on a refusal, which expires them through forget', () => {
		const { win, cookies } = tagWindow()
		const sink = sinkOn(win, true)
		sink.mode?.(to('full'))
		sink.mode?.(to('cookieless', true))
		expect(cookies).toEqual([])
	})
})

describe("GA4's cookies", () => {
	const expiry = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'

	it('are expired on any refusal, on the host and on every parent domain, granted here or not', () => {
		const { win, cookies } = tagWindow()
		sinkOn(win, false).forget?.()
		expect(gaCookieNames(ID)).toEqual(['_ga', '_ga_AB12CD34'])
		expect(cookies).toEqual(
			gaCookieNames(ID).flatMap((name) => [
				`${name}=; ${expiry}`,
				`${name}=; ${expiry}; domain=www.shop.example.com`,
				`${name}=; ${expiry}; domain=shop.example.com`,
				`${name}=; ${expiry}; domain=example.com`,
			])
		)
	})

	it('are expired on the host alone when it has no parent domain', () => {
		const { win, cookies } = tagWindow('localhost')
		sinkOn(win, true).forget?.()
		expect(cookies).toEqual(gaCookieNames(ID).map((name) => `${name}=; ${expiry}`))
	})

	it('are expired when an exclusion stops a tag this page granted', () => {
		const { win, cookies } = tagWindow('localhost')
		const sink = sinkOn(win, false)
		sink.mode?.(to('full'))
		expect(cookies).toEqual([])
		sink.mode?.(to('off'))
		expect(Reflect.get(win, ga4DisableKey(ID))).toBe(true)
		expect(cookies).toEqual(gaCookieNames(ID).map((name) => `${name}=; ${expiry}`))
	})
})

describe('a strict GA4 slot', () => {
	it('grants nothing on consent', () => {
		const { win, gtag } = tagWindow()
		sinkOn(win, false).mode?.(to('full'))
		expect(consentUpdates(gtag)).toEqual([])
	})
})
