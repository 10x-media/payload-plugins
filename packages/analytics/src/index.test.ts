import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { analytics } from './index'
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
})
