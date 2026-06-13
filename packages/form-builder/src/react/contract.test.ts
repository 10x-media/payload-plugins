import { describe, expect, it } from 'vitest'
import { defineFieldRenderer } from './contract'

describe('defineFieldRenderer', () => {
	it('returns the renderer unchanged (identity for inference)', () => {
		const renderer = defineFieldRenderer(() => null)
		expect(typeof renderer).toBe('function')
	})
})
