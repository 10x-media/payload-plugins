import { withEncryptedQueryRewrite } from '@10x-media/fields/encrypted'
import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { analytics } from './index'
import { PROVIDERS_SLUG } from './providers/collection'
import { memoryAdapter } from './testing/memoryAdapter'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('analytics factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof analytics({ adapters: [memoryAdapter()] })).toBe('function')
	})
	it('returns the incoming config when disabled', async () => {
		const cfg = fakeConfig()
		expect(await analytics({ disabled: true })(cfg)).toBe(cfg)
	})
	it('registers translations when enabled', async () => {
		const out = (await analytics({ adapters: [memoryAdapter()] })(fakeConfig())) as Config
		expect(out.i18n?.translations).toBeDefined()
	})
	it('registers German translations out of the box', async () => {
		const out = (await analytics({ adapters: [memoryAdapter()] })(fakeConfig())) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.analytics?.metricPageviews).toBe('Seitenaufrufe')
		expect(i18n.de?.analytics?.comparisonVsPrevious).toBe('vs. vorheriger Zeitraum')
		expect(i18n.de?.analytics?.comparisonIncrease).toBe('Gestiegen')
		expect(i18n.de?.analytics?.comparisonDecrease).toBe('Gesunken')
		expect(i18n.de?.analytics?.comparisonNoChange).toBe('Keine Änderung')
	})

	it('applies the translations option and a project override wins over the built-in', async () => {
		const out = (await analytics({
			adapters: [memoryAdapter()],
			translations: { de: { [keys.pluginName]: 'Analytik' } },
		})(fakeConfig())) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.analytics?.pluginName).toBe('Analytik')
		expect(i18n.en?.analytics?.pluginName).toBe('Analytics')
		// Built-in German keys not overridden remain intact.
		expect(i18n.de?.analytics?.metricPageviews).toBe('Seitenaufrufe')
	})
	it('throws when no adapters are supplied', async () => {
		await expect(analytics({ adapters: [] })(fakeConfig())).rejects.toThrow(/at least one adapter/i)
	})
	it('invokes an adapter register hook against the config', async () => {
		const calls: string[] = []
		const reg = {
			...memoryAdapter(),
			register: (cfg: Config) => {
				calls.push('registered')
				cfg.custom = { ...(cfg.custom ?? {}), analyticsRegistered: true }
			},
		}
		const out = (await analytics({ adapters: [reg] })(fakeConfig())) as Config
		expect(calls).toEqual(['registered'])
		expect(out.custom?.analyticsRegistered).toBe(true)
	})

	it('wraps the providers collection with the encrypted response strip on its own', async () => {
		const out = (await analytics({
			adapters: [memoryAdapter()],
			providers: { collection: true },
		})(fakeConfig())) as Config
		const providers = out.collections?.find((c) => c.slug === PROVIDERS_SLUG)
		expect(providers?.hooks?.afterRead?.length).toBeGreaterThan(0)
	})

	it('stays sound when wrapped a second time, as a consumer fields() plugin would', async () => {
		const out = (await analytics({
			adapters: [memoryAdapter()],
			providers: { collection: true },
		})(fakeConfig())) as Config
		const providers = out.collections?.find((c) => c.slug === PROVIDERS_SLUG)
		if (!providers) throw new Error('providers collection missing')

		// Simulates a consumer's own @10x-media/fields plugin wrapping this
		// collection again after analytics() already did (see the "always wrap"
		// comment in index.ts): double application must not throw, and the strip
		// stays a no-op past the first pass.
		const rewrapped = withEncryptedQueryRewrite(providers)
		expect(rewrapped.hooks?.afterRead).toHaveLength(2)

		let doc: Record<string, unknown> = {
			plausible: { apiKey: 'pfe1.k0.fake.ciphertext', siteId: 'example.com' },
		}
		for (const hook of rewrapped.hooks?.afterRead ?? []) {
			doc = (await hook({ context: {}, doc } as never)) as Record<string, unknown>
		}
		expect((doc.plausible as Record<string, unknown>).apiKey).toBeUndefined()
		expect((doc.plausible as Record<string, unknown>).siteId).toBe('example.com')
	})
})

// The peer-import catch classifies module-resolution failures (translated to a
// setup-instruction error) from everything else (rethrown unchanged); see
// `isModuleNotFoundError` and its dedicated tests in ./plugin/peerImportError.test.ts.
// Mocking a genuine `import()` rejection here to exercise the branch end-to-end is
// unreliable: vitest treats a throwing mock factory as a mock-setup error rather
// than a simulated import failure.
