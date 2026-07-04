import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { jobs } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('jobs factory', () => {
	it('returns a Payload plugin function when enabled', () => {
		expect(typeof jobs({})).toBe('function')
	})

	it('returns a Payload plugin function when disabled', () => {
		expect(typeof jobs({ disabled: true })).toBe('function')
	})

	it('applies the translations option', () => {
		const out = jobs({ translations: { de: { [keys.pluginName]: 'Aufgaben' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.jobs?.pluginName).toBe('Aufgaben')
		expect(i18n.en?.jobs?.pluginName).toBe('Jobs')
	})
})
