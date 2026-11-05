import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { umami } from '../adapters/umami/umami'
import { native } from '../native/nativeAdapter'
import { adapterFromProviderDoc } from '../providers/factory'
import { DEFAULT_HOST_POLICY } from '../providers/hosts'
import type { AdapterLabelArgs, AnalyticsAdapter } from './contract'
import { type AdapterLabelOption, sourceLabelFor } from './sourceLabel'

const reqIn = (language: string, fallbackLanguage?: string) => {
	const warn = vi.fn()
	const req = {
		i18n: { language, ...(fallbackLanguage ? { fallbackLanguage } : {}) },
		payload: { logger: { warn } },
	} as unknown as PayloadRequest
	return { req, warn }
}

const FACTORIES: Array<[string, string, (label?: AdapterLabelOption) => AnalyticsAdapter]> = [
	['posthog', 'PostHog', (label) => posthog({ projectId: '1', apiKey: 'phx', label })],
	['plausible', 'Plausible', (label) => plausible({ siteId: 's', apiKey: 'k', label })],
	['umami', 'Umami', (label) => umami({ websiteId: 'w', apiKey: 'k', label })],
	[
		'ga4',
		'Google Analytics 4',
		(label) =>
			ga4({ propertyId: '1', credentials: { client_email: 'a@b.c', private_key: 'k' }, label }),
	],
	['native', 'Payload', (label) => native({ label })],
]

describe.each(FACTORIES)('%s({ label })', (name, vendor, make) => {
	it('keeps the vendor name when unset or blank', async () => {
		const { req } = reqIn('en')
		expect(make().label).toBe(vendor)
		expect(make('  ').label).toBe(vendor)
		expect(await sourceLabelFor(make(), { req, scope: null })).toBe(vendor)
	})

	it('names the source with a string for every reader', async () => {
		const adapter = make('Platform (PostHog)')
		const { req } = reqIn('de')
		expect(adapter.label).toBe('Platform (PostHog)')
		expect(await sourceLabelFor(adapter, { req, scope: 'alpha' })).toBe('Platform (PostHog)')
	})

	it('reads a map in the reader language, then the fallback language, then en', async () => {
		const adapter = make({ en: 'Traffic', de: 'Verkehr', fr: 'Trafic' })
		expect(adapter.label).toBe('Traffic')
		expect(await sourceLabelFor(adapter, { req: reqIn('de').req, scope: null })).toBe('Verkehr')
		expect(await sourceLabelFor(adapter, { req: reqIn('ja', 'fr').req, scope: null })).toBe(
			'Trafic'
		)
		expect(await sourceLabelFor(adapter, { req: reqIn('ja').req, scope: null })).toBe('Traffic')
	})

	it('labels a map without en by its first entry where no reader is known', () => {
		expect(make({ de: 'Verkehr', fr: 'Trafic' }).label).toBe('Verkehr')
	})

	it('asks a function per reader and scope, keeping the vendor name as its plain label', async () => {
		const labelFor = vi.fn(({ req, scope }: AdapterLabelArgs) =>
			req.user ? 'Platform (PostHog)' : `${scope} analytics`
		)
		const adapter = make(labelFor)
		expect(adapter.label).toBe(vendor)
		const { req } = reqIn('en')
		expect(await sourceLabelFor(adapter, { req, scope: 'paddle' })).toBe('paddle analytics')
		expect(labelFor).toHaveBeenCalledWith({ req, scope: 'paddle' })
	})

	it('refuses a label that is none of the three forms', () => {
		expect(() => make(42 as never)).toThrow(
			new RegExp(`analytics: ${name}\\(\\{ label \\}\\) must be a label`)
		)
		expect(() => make(['a'] as never)).toThrow(/got an array/)
	})
})

describe('sourceLabelFor', () => {
	const adapter = (labelFor: AnalyticsAdapter['labelFor']) => ({
		id: 'ph',
		label: 'PostHog',
		labelFor,
	})

	it('falls back to the plain label, with a warning, when the function throws', async () => {
		const { req, warn } = reqIn('en')
		const label = await sourceLabelFor(
			adapter(async () => {
				throw new Error('tenant lookup down')
			}),
			{ req, scope: 'alpha' }
		)
		expect(label).toBe('PostHog')
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('tenant lookup down'))
	})

	it('falls back to the plain label, with a warning, when the function names nothing', async () => {
		const { req, warn } = reqIn('en')
		expect(
			await sourceLabelFor(
				adapter(() => ''),
				{ req, scope: null }
			)
		).toBe('PostHog')
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('source "ph"'))
	})
})

describe('a provider document source', () => {
	it('keeps its document name for every reader, whatever the lent adapter says', async () => {
		const lent = adapterFromProviderDoc(
			{ id: 'doc7', provider: 'native', name: 'Shop analytics' },
			{
				fetch: async () => Response.json({}),
				hosts: DEFAULT_HOST_POLICY,
				native: native({ label: () => 'Per reader' }),
			}
		)
		const { req } = reqIn('en')
		expect(lent?.label).toBe('Shop analytics')
		expect(lent && (await sourceLabelFor(lent, { req, scope: 'alpha' }))).toBe('Shop analytics')
	})
})
