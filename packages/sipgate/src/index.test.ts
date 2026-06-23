import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { sipgate } from './index'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('sipgate factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof sipgate({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(sipgate({ disabled: true })(cfg)).toBe(cfg)
	})
})
