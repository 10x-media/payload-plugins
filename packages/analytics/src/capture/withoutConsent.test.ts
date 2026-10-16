import { describe, expect, it, vi } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { umami } from '../adapters/umami/umami'
import type { CaptureSupport } from '../core/capture'
import type { AnalyticsAdapter } from '../core/contract'
import type { ResolvedWithoutConsent, WithoutConsentArgs } from '../core/options'
import { native } from '../native/nativeAdapter'
import { slotWithoutConsent } from './withoutConsent'

const ga4Config = {
	propertyId: '1',
	credentials: { client_email: 'a@b.c', private_key: 'k' },
	measurementId: 'G-AB12CD34',
}
const posthogConfig = { projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' }

const captureOf = (adapter: AnalyticsAdapter): CaptureSupport => {
	if (!adapter.capture) {
		throw new Error(`${adapter.id} declares no capture`)
	}
	return adapter.capture
}

const modes = (
	adapter: AnalyticsAdapter,
	option: ResolvedWithoutConsent | undefined,
	onError?: (err: unknown) => void
) => {
	const capture = captureOf(adapter)
	return slotWithoutConsent(
		{ slot: 'global', adapterId: adapter.id, kind: capture.client.kind, capture, option },
		onError
	)
}

const COOKIELESS = { pending: 'cookieless', refused: 'cookieless' }

describe('slotWithoutConsent', () => {
	it('counts cookielessly in both phases by default, for every vendor but GA4', () => {
		for (const adapter of [
			native(),
			plausible({ siteId: 's', apiKey: 'k', domain: 'example.com' }),
			umami({ websiteId: 'w', apiKey: 'k' }),
			posthog(posthogConfig),
		]) {
			expect(modes(adapter, undefined), adapter.id).toEqual(COOKIELESS)
		}
	})

	it("keeps GA4 strict under 'cookieless', which takes each adapter's declared default", () => {
		expect(modes(ga4(ga4Config), undefined)).toBeUndefined()
		expect(modes(ga4(ga4Config), { pending: 'cookieless', refused: 'cookieless' })).toBeUndefined()
	})

	it("sends nothing in a phase the install sets 'off', and nothing at all for 'off' throughout", () => {
		expect(modes(native(), { pending: 'cookieless', refused: 'off' })).toEqual({
			pending: 'cookieless',
			refused: 'off',
		})
		expect(modes(posthog(posthogConfig), { pending: 'off', refused: 'off' })).toBeUndefined()
	})

	it("lets the adapter's own setting win over the install, the function included", () => {
		const answer = vi.fn(() => 'cookieless' as const)
		expect(
			modes(
				plausible({ siteId: 's', apiKey: 'k', domain: 'example.com', withoutConsent: 'off' }),
				answer
			)
		).toBeUndefined()
		expect(answer).not.toHaveBeenCalled()
		expect(
			modes(ga4({ ...ga4Config, withoutConsent: 'cookieless' }), { pending: 'off', refused: 'off' })
		).toEqual(COOKIELESS)
		expect(modes(native({ withoutConsent: 'anonymous' }), undefined)).toEqual({
			pending: 'anonymous',
			refused: 'anonymous',
		})
	})

	it("asks the function per phase and takes its answer as is, so 'cookieless' opts GA4 in", () => {
		const seen: WithoutConsentArgs[] = []
		const answer = (args: WithoutConsentArgs) => {
			seen.push(args)
			return args.phase === 'pending' ? ('cookieless' as const) : ('off' as const)
		}
		expect(modes(ga4(ga4Config), answer)).toEqual({ pending: 'cookieless', refused: 'off' })
		expect(seen).toEqual([
			{ slot: 'global', adapterId: 'ga4', kind: 'ga4', phase: 'pending' },
			{ slot: 'global', adapterId: 'ga4', kind: 'ga4', phase: 'refused' },
		])
	})

	it('fails closed on a function that throws or answers anything else, reporting it', () => {
		const onError = vi.fn()
		const throws = () => {
			throw new Error('boom')
		}
		expect(modes(native(), throws, onError)).toBeUndefined()
		const nonsense = (() => 'full') as unknown as ResolvedWithoutConsent
		expect(modes(native(), nonsense, onError)).toBeUndefined()
		expect(onError).toHaveBeenCalledTimes(4)
		expect(String(onError.mock.calls[2]?.[0])).toMatch(/answered "full"/)
	})

	it('keeps an adapter declaring no cookieless support off, whatever anyone says', () => {
		const { cookieless: _cookieless, ...strict } = captureOf(
			native({ withoutConsent: 'cookieless' })
		)
		expect(
			slotWithoutConsent({
				slot: 'tenant',
				adapterId: 'custom',
				kind: 'native',
				capture: strict,
				option: () => 'cookieless',
			})
		).toBeUndefined()
	})
})

describe('adapter withoutConsent options', () => {
	it('declares how each vendor counts without consent', () => {
		expect(captureOf(native()).cookieless).toEqual({ kind: 'inherent' })
		expect(captureOf(plausible({ siteId: 's', apiKey: 'k', domain: 'x.com' })).cookieless).toEqual({
			kind: 'inherent',
		})
		expect(captureOf(umami({ websiteId: 'w' })).cookieless).toEqual({ kind: 'inherent' })
		expect(captureOf(posthog(posthogConfig)).cookieless).toEqual({ kind: 'switched' })
		expect(captureOf(ga4(ga4Config)).cookieless).toEqual({ kind: 'switched', default: 'off' })
	})

	it('refuses a level the factory does not take, at boot, by name', () => {
		const bad = 'anonymous' as unknown as 'off'
		expect(() => plausible({ siteId: 's', apiKey: 'k', withoutConsent: bad })).toThrow(
			`analytics: plausible({ withoutConsent }) must be 'cookieless' or 'off', got "anonymous"`
		)
		expect(() => umami({ websiteId: 'w', withoutConsent: bad })).toThrow(
			/umami\(\{ withoutConsent \}\)/
		)
		expect(() => posthog({ ...posthogConfig, withoutConsent: bad })).toThrow(
			/posthog\(\{ withoutConsent \}\)/
		)
		expect(() => ga4({ ...ga4Config, withoutConsent: bad })).toThrow(/ga4\(\{ withoutConsent \}\)/)
		expect(() => native({ withoutConsent: 'full' as unknown as 'off' })).toThrow(
			`analytics: native({ withoutConsent }) must be 'cookieless', 'anonymous' or 'off', got "full"`
		)
	})
})
