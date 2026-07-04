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
	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(analytics({ disabled: true })(cfg)).toBe(cfg)
	})
	it('registers translations when enabled', () => {
		const out = analytics({ adapters: [memoryAdapter()] })(fakeConfig()) as Config
		expect(out.i18n?.translations).toBeDefined()
	})
	it('applies the translations option', () => {
		const out = analytics({
			adapters: [memoryAdapter()],
			translations: { de: { [keys.pluginName]: 'Analytik' } },
		})(fakeConfig()) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.analytics?.pluginName).toBe('Analytik')
		expect(i18n.en?.analytics?.pluginName).toBe('Analytics')
	})
	it('throws when no adapters are supplied', () => {
		expect(() => analytics({ adapters: [] })(fakeConfig())).toThrow(/at least one adapter/i)
	})
	it('invokes an adapter register hook against the config', () => {
		const calls: string[] = []
		const reg = {
			...memoryAdapter(),
			register: (cfg: Config) => {
				calls.push('registered')
				cfg.custom = { ...(cfg.custom ?? {}), analyticsRegistered: true }
			},
		}
		const out = analytics({ adapters: [reg] })(fakeConfig()) as Config
		expect(calls).toEqual(['registered'])
		expect(out.custom?.analyticsRegistered).toBe(true)
	})
})
