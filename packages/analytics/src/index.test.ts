import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { analytics } from './index'
import { memoryAdapter } from './testing/memoryAdapter'

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
	it('throws when no adapters are supplied', () => {
		expect(() => analytics({ adapters: [] })(fakeConfig())).toThrow(/at least one adapter/i)
	})
})
