import { describe, expect, it } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { posthog } from '../adapters/posthog/posthog'
import { native } from '../native/nativeAdapter'
import {
	type AnalyticsPluginOptions,
	adapterCountsWithoutConsent,
	cookielessTrustNotice,
	resolveOptions,
	type WithoutConsentOption,
	withoutConsentUnsetNotice,
} from './options'

const ga4Adapter = () =>
	ga4({
		propertyId: '1',
		credentials: { client_email: 'a@b.c', private_key: 'k' },
		measurementId: 'G-AB12CD34',
	})

const resolve = (
	withoutConsent: WithoutConsentOption | undefined,
	extra: Partial<AnalyticsPluginOptions> = {}
) =>
	resolveOptions({
		adapters: [native()],
		capture: { gate: 'all', ...(withoutConsent === undefined ? {} : { withoutConsent }) },
		...extra,
	})

const UNSET_LINE =
	"analytics: capture.withoutConsent is unset, so held slots measure cookielessly before consent and after a refusal. Set it to 'off' to send nothing without consent."

describe('capture.withoutConsent', () => {
	it('fills the shorthand and the object per phase, an omitted phase being cookieless', () => {
		expect(resolve('off').capture.withoutConsent).toEqual({ pending: 'off', refused: 'off' })
		expect(resolve('cookieless').capture.withoutConsent).toEqual({
			pending: 'cookieless',
			refused: 'cookieless',
		})
		expect(resolve({ refused: 'off' }).capture.withoutConsent).toEqual({
			pending: 'cookieless',
			refused: 'off',
		})
		const answer = () => 'off' as const
		expect(resolve(answer).capture.withoutConsent).toBe(answer)
		expect(resolve(undefined).capture.withoutConsent).toBeUndefined()
	})

	it('refuses anything else at boot, by name', () => {
		const bad = (value: unknown) => () => resolve(value as WithoutConsentOption)
		expect(bad('none')).toThrow(
			`analytics: capture.withoutConsent must be 'cookieless', 'off', an object such as { refused: 'off' } or a function, got "none"`
		)
		expect(bad({ pending: 'anonymous' })).toThrow(
			`analytics: capture.withoutConsent.pending must be 'cookieless' or 'off', got "anonymous"`
		)
		expect(bad({ later: 'off' })).toThrow(/capture\.withoutConsent/)
		expect(bad(['off'])).toThrow(/got an array/)
	})
})

describe('withoutConsentUnsetNotice', () => {
	it('names the default in effect while the option is unset and a held slot counts', () => {
		expect(withoutConsentUnsetNotice(resolve(undefined))).toBe(UNSET_LINE)
	})

	it('stays quiet once the option is set, or when no held slot could count without consent', () => {
		expect(withoutConsentUnsetNotice(resolve('cookieless'))).toBeNull()
		expect(withoutConsentUnsetNotice(resolve('off'))).toBeNull()
		expect(withoutConsentUnsetNotice(resolve(undefined, { capture: { gate: 'off' } }))).toBeNull()
		expect(
			withoutConsentUnsetNotice(resolve(undefined, { capture: { gate: ['tenant'] } }))
		).toBeNull()
		expect(
			withoutConsentUnsetNotice(
				resolveOptions({ adapters: [ga4Adapter()], capture: { gate: 'all' } })
			)
		).toBeNull()
	})

	it('speaks for a function gate and a tenant slot runtime providers fill, without calling host code', () => {
		const gate = () => {
			throw new Error('called at boot')
		}
		expect(withoutConsentUnsetNotice(resolve(undefined, { capture: { gate } }))).toBe(UNSET_LINE)
		const scoped = resolveOptions({
			adapters: [native()],
			capture: { gate: ['tenant'], slots: { global: false } },
			scope: { resolve: () => 'a', member: () => true },
			providers: { collection: true },
		})
		expect(withoutConsentUnsetNotice(scoped)).toBe(UNSET_LINE)
	})
})

describe('a tenant slot only provider documents fill', () => {
	// The slot names a vendor no config adapter is, so only the providers rule can judge it.
	const documentsOnly = (withoutConsent?: WithoutConsentOption) =>
		resolveOptions({
			adapters: [native()],
			capture: {
				gate: ['tenant'],
				slots: { global: false, tenant: 'plausible' },
				...(withoutConsent === undefined ? {} : { withoutConsent }),
			},
			scope: { resolve: () => 'a', member: () => true },
			providers: { collection: true },
		})

	it('counts without consent by default, so the boot line and the trust warning speak', () => {
		const resolved = documentsOnly()
		expect(resolved.capture.installCountsWithoutConsent).toBe(true)
		expect(withoutConsentUnsetNotice(resolved)).toBe(UNSET_LINE)
		expect(cookielessTrustNotice(resolved, true)).not.toBeNull()
	})

	it("counts nothing once the install says 'off' throughout", () => {
		expect(documentsOnly('off').capture.installCountsWithoutConsent).toBe(false)
		expect(documentsOnly({ pending: 'off' }).capture.installCountsWithoutConsent).toBe(true)
	})
})

describe('adapterCountsWithoutConsent', () => {
	const ph = () => posthog({ projectId: '1', apiKey: 'phx_k', projectToken: 'phc_t' })

	it('answers per adapter, for the slot it fills and whether the gate holds that slot', () => {
		const filled = ph()
		const held = resolveOptions({ adapters: [filled], capture: { gate: 'all' } })
		expect(adapterCountsWithoutConsent(held, filled)).toBe(true)
		const ungated = resolveOptions({ adapters: [filled], capture: { gate: 'off' } })
		expect(adapterCountsWithoutConsent(ungated, filled)).toBe(false)
		const elsewhere = ph()
		const nativeFills = resolveOptions({
			adapters: [native(), elsewhere],
			platformAdapter: 'native',
			capture: { gate: 'all' },
		})
		expect(adapterCountsWithoutConsent(nativeFills, elsewhere)).toBe(false)
		const reads = posthog({ projectId: '1', apiKey: 'phx_k' })
		expect(
			adapterCountsWithoutConsent(
				resolveOptions({ adapters: [reads], capture: { gate: 'all' } }),
				reads
			)
		).toBe(false)
	})

	it("follows the adapter's own level over the install's", () => {
		const opted = posthog({
			...{ projectId: '1', apiKey: 'k', projectToken: 't' },
			withoutConsent: 'cookieless',
		})
		const strict = resolveOptions({
			adapters: [opted],
			capture: { gate: 'all', withoutConsent: 'off' },
		})
		expect(adapterCountsWithoutConsent(strict, opted)).toBe(true)
		const plain = ph()
		expect(
			adapterCountsWithoutConsent(
				resolveOptions({ adapters: [plain], capture: { gate: 'all', withoutConsent: 'off' } }),
				plain
			)
		).toBe(false)
	})
})

describe('cookielessTrustNotice', () => {
	it('warns in production when a held slot counts cookielessly and no trust option is set', () => {
		const notice = cookielessTrustNotice(resolve(undefined), true)
		expect(notice).toMatch(/hash of the client IP address/)
		expect(notice).toMatch(/trustedProxyHops/)
		expect(notice).toMatch(/trustedPlatform/)
	})

	it('stays quiet with a trust option, outside production, and with nothing counted cookielessly', () => {
		expect(cookielessTrustNotice(resolve(undefined, { trustedProxyHops: 1 }), true)).toBeNull()
		expect(
			cookielessTrustNotice(resolve(undefined, { trustedPlatform: 'vercel' }), true)
		).toBeNull()
		expect(cookielessTrustNotice(resolve(undefined), false)).toBeNull()
		expect(cookielessTrustNotice(resolve('off'), true)).toBeNull()
		expect(cookielessTrustNotice(resolve(undefined, { capture: { gate: 'off' } }), true)).toBeNull()
	})
})
